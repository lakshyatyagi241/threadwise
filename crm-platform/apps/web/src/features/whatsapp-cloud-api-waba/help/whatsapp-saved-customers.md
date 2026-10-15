---
id: whatsapp-saved-customers
title: Saved customers
summary: See every customer who ordered from your store and save their name, company and delivery address so it fills in when they order on WhatsApp.
area: settings
order: 20
documents: [tile:whatsapp-customers]
routes: [/store/customers]
keywords:
  [
    customers,
    address,
    delivery,
    order,
    store,
    whatsapp order,
    saved customer,
    company,
    lifetime total,
    crm contact,
    no saved address,
    buyer,
  ]
---

## What it is for

This screen lists every customer of your store: the people you saved and everyone who has placed an order, even if you never saved them. Saved customers have their name, company and delivery address stored in advance. When one of them orders on WhatsApp, their details are shown and they only need to reply YES to confirm. For each customer it shows what they have bought: how many orders, the total spent per currency, the date of the last order and the linked CRM contact. The list shows the most recently active customers first.

## How to use it

1. Open **Settings**, then **Saved customers** under Business. You can also open **Customers** from the Store menu.
2. A customer who ordered but has no saved address shows a **No saved address** label. Select **Edit** on them to save their name, company and delivery address. Or select **Add a customer**. Enter the phone number with its country code, the name, an optional company and the full delivery address, then select **Save customer**. Saving a phone number that already exists updates that customer.
3. To search, type a name, phone number or company in the search box. The list updates after you stop typing.
4. Select a customer's name or **View** to open the details: profile, lifetime total, the CRM contact and the latest orders. Select an order number to open it.
5. Select **Edit** to change a customer. The phone number is shown but cannot be changed, because it identifies the customer.
6. To remove a saved customer, select **Delete** and confirm. The saved details are deleted and their past orders stay in the order list. A customer who only appears because of their orders has nothing saved, so there is no **Delete**; they stay in the list for as long as their orders do.

## Options and settings

- **No saved address:** the customer has ordered but you have not saved a delivery address for them. It disappears once you save one.
- **Orders:** the number of orders placed from this phone number. Select it to open the order list filtered to that customer.
- **Lifetime total:** one line for each currency the customer paid in. Cancelled orders are not counted.
- **CRM contact:** a link to the contact when the order flow linked one, otherwise a dash.
- **Address:** the delivery address shown to the customer when they order.

Each customer has a phone number, a name, an optional company and one delivery address.

## Plan and access

You need the right to view customers to open this page, and the right to manage them to add, edit or delete. Without the manage right the list is read-only and those buttons are hidden.

## If something looks wrong

- **The phone number is refused.** Enter it with the country code. It needs at least one digit.
- **A customer's address does not fill in on an order.** Check that the phone number matches the number the customer orders from, including the country code.
- **The same person appears twice.** Orders are matched by the phone number, with your platform's default country code added to a number typed without one (for example 7999834066 becomes +91 7999834066). A genuinely different number is a different customer.
- **A customer who ordered is missing.** An order with no phone number, or one that is not a valid number, cannot be matched to a customer, so it does not appear here. It stays in the order list.
- **"Changed by someone else".** Another person saved this customer first. Reload the page and try again.
- **The list does not load.** Select **Try again**.
