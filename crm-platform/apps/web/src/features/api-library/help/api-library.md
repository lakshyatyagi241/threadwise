---
id: api-library-overview
title: API Library
summary: Save a call to another system once, test it, and run it from any flow, keeping the answer in a variable or on the contact.
area: automation
order: 15
documents: [nav:api-library]
keywords: [api, http, rest, integration, request, webhook, curl, payload, headers, function, response, mapping, logs]
---

## What it is for

The API Library holds calls to other systems that your flows can run: look up an order, create a ticket, check a stock level. You build the call once, test it here, and every flow reuses it. The answer can be kept in a flow variable or written into a contact property.

## How to use it

1. Open **API Library** in the Automation group and select **Create**.
2. Type a **name** (letters, numbers and underscores). Flows read the answer as the name followed by a field, so the name cannot change after you save.
3. Choose the **method** and type the **URL**. Use the **{ }** button beside a field to insert a variable: a contact property, a field of another API's answer, or a flow variable name.
4. Fill in a **default value** for each variable the form lists. A test run, and a flow that has no value of its own, use it.
5. Add **headers** if the other system needs them, such as an `Authorization` header.
6. For POST, PUT and PATCH, write the **payload** as JSON, or switch the payload type to multipart form data and add fields one by one.
7. Select **Run test**. The response appears on the right: its status, time, headers and body.
8. Pick what to keep from the answer (see below), then select **Save**. An API is saved only after a test run has passed.

To start from an existing call, select **Import API's** on the list and paste a cURL command. A new API opens with the method, URL, headers and payload filled in.

## Variables

Every `{{name}}` you type in the URL, a header value or the payload becomes a variable in the **Variables** section, and disappears from it when you remove it from the text. Backspace right after a variable removes it whole. A variable's value at run time comes from, in order: the value typed in the flow step, the flow's own variable of that name, the contact's property of that name, and finally the default you saved.

## Secrets

Tick **Secret** on a header that holds a key or token. Headers named like Authorization, API key or token are secret automatically. Once saved, a secret shows as ******** and is stored encrypted; nobody can read it back. Leave the ******** in place to keep it, or select **Replace** and type a new value. If you point the API at a different host, type its secret headers again.

> Do not put a secret in the URL or in a variable's default value: those are not hidden in the logs.

## Function to process the payload

For a JSON payload, tick **Add function to process payload** to reshape it before it is sent. The code must define `function processPayload(payload)` and return the payload to send. Select **Run code** to try it on the payload you typed. The code runs on the server in a sandbox with no network or file access and a 3 second limit, and you must run it successfully before you can test the API.

## Use in flow and contact properties

In the test response, select **+** beside a value to choose what it is for:

- **Use in flow** makes it available to flows as the API name followed by the field path.
- **Save as contact property** adds a row to the contact mapping. Choose the property it is written to, and a default to write when the field is empty.
- **Both** does both.

A value inside a list offers **this item** (`items[0].name`) or **every item** (`items[].name`, collected into a list). You can also add a path by hand, or pick one from the last test response.

## Logs

**Logs** on a row lists the runs of that API, newest first. **All logs** lists every run, with filters for the API, result, status code, source (test or flow) and dates, and a search over the URL, API name and error. Select a run to see its request, response, status, duration and, for a flow run, the flow and contact. Secrets are masked before a log is stored, and logs are kept for 30 days.

## Deleting

**Delete** first checks which flows use the API. If some do, they are listed and the button becomes **Delete anyway**; those steps then leave through their error port. The API's logs are kept.

## Using it in a flow

In the flow builder, add the **API (from library)** step from the Integrations group, pick the API, and fill in any variable you want to set for this step. The step leaves by **success** when the API answers 2xx and by **error** for anything else.

## If something looks wrong

- **Address blocked**: the server only calls public addresses. A private or local address is refused.
- **Not a 2xx answer**: the other system replied with an error. Check the URL, headers and payload on the Request tab of the test.
- **You cannot save**: run a test that passes first; if the form uses a function, run the code first. Your role also needs the permission to test APIs.
- **Someone else changed this API**: load the latest version, then make your changes again.
- You cannot see **API Library**: your role needs the API Library permission.
