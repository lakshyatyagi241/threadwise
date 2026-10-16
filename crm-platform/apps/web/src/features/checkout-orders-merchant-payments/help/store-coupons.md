---
id: store-coupons
title: Discount coupons
summary: Create discount codes customers enter at checkout, with a percent or flat amount off, a minimum spend, free shipping, a validity window and a usage limit.
area: store
order: 40
documents: [nav:store-coupons]
routes: [/store/coupons]
keywords:
  [
    coupon,
    discount code,
    promo code,
    percent off,
    flat discount,
    free shipping,
    usage limit,
    expiry,
    checkout,
  ]
---

## What it is for

Coupons are the discount codes your customers type at checkout. A code can take a percentage or a flat amount off the order, and it can also give free shipping. You decide when it is valid, how many times it can be used, and which shop it applies to.

## How to use it

1. Open **Coupons** in the Store menu.
2. Select **New coupon**. Enter a code (letters, numbers, dashes and underscores, for example `SUMMER10`), choose **Percent** or **Flat amount**, and enter the value.
3. Fill in the optional limits: a minimum spend, a cap on a percent discount, a start and expiry time, a usage limit and whether the code gives free shipping.
4. Choose a shop, or leave **All shops** so the code works in every shop of the workspace, then select **Create coupon**.
5. Use the switch on a row to turn a code on or off without deleting it.
6. Select **Edit** to change a code, **Usages** to see the orders that used it, or **Delete** to remove it.

## Options and settings

- **Percent:** a whole number from 0 to 100. The optional **Max discount cap** is the most it can take off one order.
- **Flat amount:** typed in your shop currency, for example `250.50`.
- **Min spend:** the order subtotal must reach this amount before the code works.
- **Starts and Expires:** the code only works between these two times. The expiry must be after the start.
- **Usage limit:** the total number of times the code can be redeemed across all customers. Leave it empty for unlimited. The table shows used and limit, with an infinity sign when there is no limit.
- **State:** **Active**, **Off**, **Scheduled** (not started yet), **Expired** or **Used up** (the limit is reached). Use the state filter and the search box to find codes.
- **Usages:** lists each order that used the code with the customer, the discount, the order total, its status and the date. Select the order number to open it.

## Plan and access

The Coupons screen needs the storefront feature on your plan. You need the permission to view coupons to open it; creating, editing, switching and deleting need the manage permission, and without it those controls are hidden or locked.

## If something looks wrong

- **"Code already used":** another coupon already has that code. Choose a different one.
- **The expiry is refused:** it must be later than the start time.
- **A customer says the code does not work:** check the state column. A code that is Off, Scheduled, Expired or Used up does not apply, and neither does one with a minimum spend the order has not reached.
- **"Changed by someone else":** another person saved this coupon first. Close the form, reload the page and try again.
- **The list could not be loaded:** select **Try again**.
