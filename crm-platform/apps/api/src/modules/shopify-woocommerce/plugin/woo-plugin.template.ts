/**
 * The source of the WooCommerce companion plugin (TW-ECOM-032), written for this product from the behaviour spec. It runs on the
 * merchant's WordPress, never in this app: the API only fills the `{{TOKENS}}` below per store and zips the result.
 *
 * Kept as text in a module (not a loose .php file) so the compiled API carries it without an asset-copy step. The tokens are
 * replaced in one pass by `woo-plugin.generator.ts`; PHP values arrive already escaped for a single-quoted string.
 */

export const PLUGIN_PHP = String.raw`<?php
/**
 * Plugin Name: {{BRAND_NAME}} for WooCommerce
 * Description: Sends checkout contact details, failed subscription payments and custom order statuses from this store to {{BRAND_NAME}}, and follows up abandoned carts.
 * Version: 1.0.0
 * Requires at least: 5.8
 * Requires PHP: 7.2
 * Author: {{BRAND_NAME}}
 * Text Domain: {{BRAND_SLUG}}-woocommerce
 * License: GPL-2.0-or-later
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * One small class: it listens to the store, keeps a short list of carts that have a phone number but no order yet,
 * and posts signed JSON to the address this plugin was generated for.
 */
final class {{BRAND_IDENT}}_Bridge {

	// Baked in when the plugin was downloaded. Never echo the secret or the address (it carries the secret) anywhere.
	const WEBHOOK_URL   = '{{WEBHOOK_URL_PHP}}';
	const WEBHOOK_KEY   = '{{WEBHOOK_SECRET_PHP}}';
	const BRAND         = '{{BRAND_NAME_PHP}}';
	const DELAY_MINUTES = {{CART_DELAY_MINUTES}};

	const OPTION        = '{{BRAND_IDENT}}_pending_carts';
	const CRON_HOOK     = '{{BRAND_IDENT}}_sweep_carts';
	const CRON_SCHEDULE = '{{BRAND_IDENT}}_every_five_minutes';
	const AJAX_ACTION   = '{{BRAND_IDENT}}_capture';
	const MAX_PENDING   = 500;
	const MAX_TRIES     = 5;
	const KEEP_SECONDS  = 604800;

	/** Statuses WooCommerce itself sends through its own webhooks; anything else is a custom status this plugin forwards. */
	const CORE_STATUSES = array( 'pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed', 'checkout-draft', 'auto-draft', 'draft', 'trash' );

	public static function boot() {
		add_filter( 'cron_schedules', array( __CLASS__, 'add_schedule' ) );
		add_action( 'init', array( __CLASS__, 'ensure_scheduled' ) );
		add_action( self::CRON_HOOK, array( __CLASS__, 'sweep' ) );

		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
		add_action( 'wp_ajax_' . self::AJAX_ACTION, array( __CLASS__, 'ajax_capture' ) );
		add_action( 'wp_ajax_nopriv_' . self::AJAX_ACTION, array( __CLASS__, 'ajax_capture' ) );

		add_action( 'woocommerce_checkout_order_processed', array( __CLASS__, 'order_placed' ), 10, 1 );
		add_action( 'woocommerce_store_api_checkout_order_processed', array( __CLASS__, 'order_placed' ), 10, 1 );
		add_action( 'woocommerce_order_status_changed', array( __CLASS__, 'status_changed' ), 10, 4 );
		add_action( 'woocommerce_subscription_renewal_payment_failed', array( __CLASS__, 'subscription_failed' ), 10, 1 );
		add_action( 'woocommerce_subscription_payment_failed', array( __CLASS__, 'subscription_failed' ), 10, 1 );
	}

	public static function activate() {
		self::ensure_scheduled();
	}

	public static function deactivate() {
		wp_clear_scheduled_hook( self::CRON_HOOK );
	}

	// ---- the five minute schedule -------------------------------------------------------------------------------

	public static function add_schedule( $schedules ) {
		$schedules[ self::CRON_SCHEDULE ] = array(
			'interval' => 300,
			'display'  => self::BRAND . ' cart sweep (every 5 minutes)',
		);
		return $schedules;
	}

	public static function ensure_scheduled() {
		if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_event( time() + 60, self::CRON_SCHEDULE, self::CRON_HOOK );
		}
	}

	// ---- checkout capture ---------------------------------------------------------------------------------------

	public static function enqueue() {
		if ( ! function_exists( 'is_checkout' ) || ! is_checkout() || is_order_received_page() ) {
			return;
		}
		$handle = '{{BRAND_SLUG}}-checkout-capture';
		wp_register_script( $handle, plugins_url( 'assets/checkout-capture.js', __FILE__ ), array(), '1.0.0', true );
		wp_localize_script(
			$handle,
			'{{BRAND_IDENT}}_capture',
			array(
				'url'    => admin_url( 'admin-ajax.php' ),
				'action' => self::AJAX_ACTION,
				'wait'   => 900,
			)
		);
		wp_enqueue_script( $handle );
	}

	/** The browser reports what the shopper has typed so far. Nothing here needs a login: the shopper is a guest. */
	public static function ajax_capture() {
		$token = isset( $_POST['token'] ) ? sanitize_text_field( wp_unslash( $_POST['token'] ) ) : '';
		if ( ! preg_match( '/^[A-Za-z0-9-]{8,64}$/', $token ) ) {
			wp_send_json( array( 'ok' => false ), 400 );
		}
		$phone = isset( $_POST['phone'] ) ? self::clean_phone( wp_unslash( $_POST['phone'] ) ) : '';
		$email = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
		if ( '' === $phone ) {
			// Without a phone number there is nothing to follow up with.
			wp_send_json( array( 'ok' => true, 'stored' => false ) );
		}
		$country = isset( $_POST['country'] ) ? strtoupper( substr( preg_replace( '/[^A-Za-z]/', '', wp_unslash( $_POST['country'] ) ), 0, 2 ) ) : '';
		$first   = isset( $_POST['first_name'] ) ? substr( sanitize_text_field( wp_unslash( $_POST['first_name'] ) ), 0, 80 ) : '';
		$last    = isset( $_POST['last_name'] ) ? substr( sanitize_text_field( wp_unslash( $_POST['last_name'] ) ), 0, 80 ) : '';

		$carts = self::carts();
		$old   = isset( $carts[ $token ] ) ? $carts[ $token ] : null;
		$carts[ $token ] = array(
			'phone'      => $phone,
			'email'      => is_email( $email ) ? $email : '',
			'country'    => $country,
			'first_name' => $first,
			'last_name'  => $last,
			'seen'       => time(),
			// Same number as before: whatever was already sent stays sent. A new number starts again.
			'posted'     => ( $old && $old['phone'] === $phone ) ? (int) $old['posted'] : 0,
			'tries'      => ( $old && $old['phone'] === $phone ) ? (int) $old['tries'] : 0,
		);
		if ( count( $carts ) > self::MAX_PENDING ) {
			uasort( $carts, array( __CLASS__, 'by_seen' ) );
			$carts = array_slice( $carts, -self::MAX_PENDING, null, true );
		}
		update_option( self::OPTION, $carts, false );
		wp_send_json( array( 'ok' => true, 'stored' => true ) );
	}

	/** An order now exists for this shopper: the cart is no longer pending. */
	public static function order_placed( $order ) {
		if ( is_numeric( $order ) && function_exists( 'wc_get_order' ) ) {
			$order = wc_get_order( $order );
		}
		if ( ! is_object( $order ) || ! method_exists( $order, 'get_billing_phone' ) ) {
			return;
		}
		$phone = self::clean_phone( $order->get_billing_phone() );
		$email = strtolower( (string) $order->get_billing_email() );
		$carts = self::carts();
		$left  = array();
		foreach ( $carts as $token => $cart ) {
			$same_phone = '' !== $phone && self::digits( $cart['phone'] ) === self::digits( $phone );
			$same_email = '' !== $email && strtolower( $cart['email'] ) === $email;
			if ( ! $same_phone && ! $same_email ) {
				$left[ $token ] = $cart;
			}
		}
		if ( count( $left ) !== count( $carts ) ) {
			update_option( self::OPTION, $left, false );
		}
	}

	/** Every five minutes: a cart that has sat idle for the delay becomes an abandoned checkout and is sent once. */
	public static function sweep() {
		if ( get_transient( self::OPTION . '_lock' ) ) {
			return;
		}
		set_transient( self::OPTION . '_lock', 1, 240 );

		$carts   = self::carts();
		$now     = time();
		$due     = $now - ( (int) self::DELAY_MINUTES * 60 );
		$sent    = 0;
		$changed = false;
		foreach ( $carts as $token => $cart ) {
			if ( $cart['seen'] < $now - self::KEEP_SECONDS ) {
				unset( $carts[ $token ] );
				$changed = true;
				continue;
			}
			if ( $cart['posted'] > 0 || $cart['tries'] >= self::MAX_TRIES || $cart['seen'] > $due || $sent >= 50 ) {
				continue;
			}
			$ok = self::post( 'checkout.created', self::checkout_payload( $token, $cart ) );
			if ( $ok ) {
				$carts[ $token ]['posted'] = $now;
			} else {
				$carts[ $token ]['tries'] = $cart['tries'] + 1;
			}
			++$sent;
			$changed = true;
		}
		if ( $changed ) {
			update_option( self::OPTION, $carts, false );
		}
		delete_transient( self::OPTION . '_lock' );
	}

	private static function checkout_payload( $token, $cart ) {
		return array(
			'token'        => $token,
			'cart_key'     => $token,
			'email'        => $cart['email'],
			'phone'        => $cart['phone'],
			'billing'      => array(
				'first_name' => $cart['first_name'],
				'last_name'  => $cart['last_name'],
				'email'      => $cart['email'],
				'phone'      => $cart['phone'],
				'country'    => $cart['country'],
			),
			'checkout_url' => function_exists( 'wc_get_checkout_url' ) ? wc_get_checkout_url() : home_url( '/' ),
			'captured_at'  => gmdate( 'c', (int) $cart['seen'] ),
			'source'       => get_bloginfo( 'url' ),
		);
	}

	// ---- order statuses and subscriptions -----------------------------------------------------------------------

	/** A status WooCommerce does not know by default (one a store or another plugin added) is sent as an order update. */
	public static function status_changed( $order_id, $from, $to, $order = null ) {
		$to = (string) $to;
		if ( '' === $to || in_array( $to, self::CORE_STATUSES, true ) ) {
			return;
		}
		if ( ! is_object( $order ) && function_exists( 'wc_get_order' ) ) {
			$order = wc_get_order( $order_id );
		}
		if ( ! is_object( $order ) || self::seen_recently( 'status-' . $order_id . '-' . $to ) ) {
			return;
		}
		self::post( 'order.updated', self::order_payload( $order, $to ) );
	}

	/** A renewal payment failed on a subscription (WooCommerce Subscriptions). */
	public static function subscription_failed( $subscription ) {
		if ( ! is_object( $subscription ) || ! method_exists( $subscription, 'get_id' ) ) {
			return;
		}
		if ( self::seen_recently( 'subscription-' . $subscription->get_id() ) ) {
			return;
		}
		$payload                  = self::order_payload( $subscription, (string) $subscription->get_status() );
		$payload['subscription']  = true;
		$payload['next_payment']  = method_exists( $subscription, 'get_date' ) ? (string) $subscription->get_date( 'next_payment' ) : '';
		$payload['payment_url']   = method_exists( $subscription, 'get_checkout_payment_url' ) ? (string) $subscription->get_checkout_payment_url() : '';
		self::post( 'subscription.payment_failed', $payload );
	}

	/** The parts of an order the receiving side reads. Written out one by one so nothing private rides along. */
	private static function order_payload( $order, $status ) {
		$items = array();
		if ( method_exists( $order, 'get_items' ) ) {
			foreach ( $order->get_items() as $item ) {
				$items[] = array(
					'name'     => (string) $item->get_name(),
					'quantity' => (int) $item->get_quantity(),
					'total'    => (string) $item->get_total(),
				);
			}
		}
		$created = method_exists( $order, 'get_date_created' ) ? $order->get_date_created() : null;
		return array(
			'id'                   => (int) $order->get_id(),
			'number'               => method_exists( $order, 'get_order_number' ) ? (string) $order->get_order_number() : (string) $order->get_id(),
			'order_key'            => method_exists( $order, 'get_order_key' ) ? (string) $order->get_order_key() : '',
			'status'               => (string) $status,
			'currency'             => (string) $order->get_currency(),
			'total'                => (string) $order->get_total(),
			'payment_method'       => method_exists( $order, 'get_payment_method' ) ? (string) $order->get_payment_method() : '',
			'payment_method_title' => method_exists( $order, 'get_payment_method_title' ) ? (string) $order->get_payment_method_title() : '',
			'date_created'         => $created ? $created->date( 'c' ) : '',
			'billing'              => array(
				'first_name' => (string) $order->get_billing_first_name(),
				'last_name'  => (string) $order->get_billing_last_name(),
				'email'      => (string) $order->get_billing_email(),
				'phone'      => (string) $order->get_billing_phone(),
				'country'    => (string) $order->get_billing_country(),
			),
			'line_items'           => $items,
		);
	}

	// ---- sending ------------------------------------------------------------------------------------------------

	/** Posts one signed delivery. Returns true on a 2xx answer. Nothing is logged: the address carries the secret. */
	private static function post( $topic, $payload ) {
		$body = wp_json_encode( $payload );
		if ( false === $body ) {
			return false;
		}
		$signature = base64_encode( hash_hmac( 'sha256', $body, self::WEBHOOK_KEY, true ) );
		$response  = wp_remote_post(
			self::WEBHOOK_URL,
			array(
				'timeout'     => 10,
				'redirection' => 0,
				'blocking'    => true,
				'headers'     => array(
					'Content-Type'              => 'application/json',
					'X-WC-Webhook-Topic'        => $topic,
					'X-WC-Webhook-Signature'    => $signature,
					'X-WC-Webhook-Delivery-ID'  => wp_generate_uuid4(),
					'X-WC-Webhook-Source'       => get_bloginfo( 'url' ),
				),
				'body'        => $body,
			)
		);
		if ( is_wp_error( $response ) ) {
			return false;
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		return $code >= 200 && $code < 300;
	}

	// ---- small helpers ------------------------------------------------------------------------------------------

	private static function carts() {
		$carts = get_option( self::OPTION, array() );
		return is_array( $carts ) ? $carts : array();
	}

	public static function by_seen( $a, $b ) {
		return (int) $a['seen'] - (int) $b['seen'];
	}

	private static function digits( $value ) {
		return preg_replace( '/\D+/', '', (string) $value );
	}

	/** Keeps a leading plus and the digits; a number with fewer than six or more than twenty digits is not a phone number. */
	private static function clean_phone( $value ) {
		$value  = trim( (string) $value );
		$digits = self::digits( $value );
		if ( strlen( $digits ) < 6 || strlen( $digits ) > 20 ) {
			return '';
		}
		return ( 0 === strpos( $value, '+' ) ? '+' : '' ) . $digits;
	}

	/** True when the same key was already handled in the last minute (a status or payment hook can fire twice). */
	private static function seen_recently( $key ) {
		$name = self::OPTION . '_' . md5( $key );
		if ( get_transient( $name ) ) {
			return true;
		}
		set_transient( $name, 1, 60 );
		return false;
	}
}

register_activation_hook( __FILE__, array( '{{BRAND_IDENT}}_Bridge', 'activate' ) );
register_deactivation_hook( __FILE__, array( '{{BRAND_IDENT}}_Bridge', 'deactivate' ) );
add_action( 'plugins_loaded', array( '{{BRAND_IDENT}}_Bridge', 'boot' ) );
`;

export const CAPTURE_JS = String.raw`/* {{BRAND_NAME}} for WooCommerce: reports the checkout phone and email while the shopper types, before any order exists. */
(function () {
	'use strict';

	var cfg = window.{{BRAND_IDENT}}_capture;
	if (!cfg || !window.fetch) {
		return;
	}

	var TOKEN_KEY = '{{BRAND_IDENT}}_cart_token';
	var FIELDS = {
		phone: ['#billing_phone', '#billing-phone', '#shipping-phone'],
		email: ['#billing_email', '#email'],
		first_name: ['#billing_first_name', '#billing-first_name'],
		last_name: ['#billing_last_name', '#billing-last_name'],
		country: ['#billing_country', '#billing-country']
	};
	var watched = [].concat(FIELDS.phone, FIELDS.email, FIELDS.first_name, FIELDS.last_name, FIELDS.country).join(',');
	var timer = null;
	var lastSent = '';
	var memoryToken = '';

	function randomToken() {
		if (window.crypto && window.crypto.randomUUID) {
			return window.crypto.randomUUID();
		}
		return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
	}

	function token() {
		try {
			var saved = window.localStorage.getItem(TOKEN_KEY);
			if (!saved) {
				saved = randomToken();
				window.localStorage.setItem(TOKEN_KEY, saved);
			}
			return saved;
		} catch (e) {
			memoryToken = memoryToken || randomToken();
			return memoryToken;
		}
	}

	function read(selectors) {
		for (var i = 0; i < selectors.length; i++) {
			var el = document.querySelector(selectors[i]);
			if (el && typeof el.value === 'string' && el.value.trim() !== '') {
				return el.value.trim();
			}
		}
		return '';
	}

	function send() {
		var data = {
			phone: read(FIELDS.phone),
			email: read(FIELDS.email),
			first_name: read(FIELDS.first_name),
			last_name: read(FIELDS.last_name),
			country: read(FIELDS.country)
		};
		if (data.phone.replace(/\D/g, '').length < 6) {
			return;
		}
		var key = JSON.stringify(data);
		if (key === lastSent) {
			return;
		}
		lastSent = key;

		var body = new URLSearchParams();
		body.set('action', cfg.action);
		body.set('token', token());
		Object.keys(data).forEach(function (name) {
			body.set(name, data[name]);
		});
		window.fetch(cfg.url, {
			method: 'POST',
			credentials: 'same-origin',
			keepalive: true,
			headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
			body: body.toString()
		}).catch(function () {
			lastSent = '';
		});
	}

	function onChange(event) {
		var target = event.target;
		if (!target || !target.matches || !target.matches(watched)) {
			return;
		}
		window.clearTimeout(timer);
		timer = window.setTimeout(send, cfg.wait || 900);
	}

	document.addEventListener('input', onChange, true);
	document.addEventListener('change', onChange, true);
	window.setTimeout(send, 1500);
})();
`;

export const README_TXT = String.raw`=== {{BRAND_NAME}} for WooCommerce ===
Requires at least: 5.8
Requires PHP: 7.2
Stable tag: 1.0.0
License: GPLv2 or later

Connects this WooCommerce store to {{BRAND_NAME}}.

== Description ==

* Reads the phone number and email a shopper types at checkout, a moment after they stop typing, before an order exists.
* Sends a cart that has been idle for {{CART_DELAY_MINUTES}} minutes to {{BRAND_NAME}} as an abandoned checkout, unless an order was placed for that phone or email.
* Forwards failed subscription renewal payments (WooCommerce Subscriptions).
* Forwards orders that move to a custom status.
* Checks for idle carts every five minutes through WP-Cron.

Everything is sent over HTTPS to one address, signed with a key that is saved inside this plugin. Keep the plugin file private.

== Installation ==

1. In WordPress go to Plugins, Add New, Upload Plugin and choose the downloaded zip file.
2. Activate it.
3. Make sure WP-Cron runs on your site (visit it now and then, or call wp-cron.php from a real cron job).

To change the address or key, download the plugin again from {{BRAND_NAME}}.
`;
