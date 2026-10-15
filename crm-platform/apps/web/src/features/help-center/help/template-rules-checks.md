---
id: template-rules-checks
title: Template rules and pre-submit checks
summary: What the Pre-submit checks flag as errors and warnings, and how to write a template that clears them before you send it to Meta.
area: campaigns
order: 52
documents: [nav:templates]
keywords:
  [
    template rules,
    pre-submit checks,
    approval,
    lint,
    body,
    header,
    footer,
    limits,
    warnings,
    errors,
  ]
---

## What it is for

While you write a template, the **Pre-submit checks** panel on the right of the form reads it against the rules Meta's review commonly enforces. Fixing problems here is faster than waiting for a refusal. This guide lists what the checks look for. Variables and buttons have their own guide: [Template variables and buttons](help:template-variables-buttons).

## How the checks work

- **Errors** block **Submit to Meta**. Nothing is sent to Meta until every error is gone.
- **Warnings** do not block. They point at wording that Meta's review often flags, so read them before you submit.
- The checks run again on our server when you submit. If the panel says it could not run, you can still submit and the server checks.
- **Save draft** never needs a clean result. Keep a half-finished template as a draft for as long as you like.

## Rules that are errors

- **Name.** Required. Only a to z, 0 to 9 and underscores, up to 60 characters. Capital letters and spaces are fixed for you as you type.
- **Language.** Must be a language code such as `en_US`.
- **Body.** Required, at most 1024 characters.
- **Spacing.** No tab characters, and no run of four or more spaces.
- **Variables.** Two variables must not sit next to each other: put text between them. Numbers must run 1, 2, 3 with no gaps. Typed names such as `{{first_name}}` are numbered for you when you save.
- **Header.** Text up to 60 characters with at most one variable. A media header (image, video or document) needs a sample file.
- **Footer.** Up to 60 characters, and no variables.
- **Emojis.** More than 10 emojis in a Marketing template.
- **Buttons.** See [Template variables and buttons](help:template-variables-buttons) for the limits.

## Rules that are warnings

- A body over 800 characters. Shorter templates tend to be approved more often.
- Three or more blank lines in a row.
- A word written in capitals, five letters or more.
- A Marketing template with no variable at all.
- A body that starts or ends with a variable.
- More than 10 emojis in a template that is not Marketing.
- A variable with no sample value. Meta expects a sample for every variable.
- Phrases that reviews often flag, such as "act now", "click here" or "guaranteed". The warning names the phrase.

## Writing for a quick approval

1. Choose the category that matches the message: **Utility** for an order or account update, **Marketing** for offers, **Authentication** for one-time codes. Meta reviews and prices a template by its category.
2. Keep the body short and specific. Say who it is from and why they are getting it.
3. Fill in a realistic sample value for every variable under **Variable mapping**, for example a real-looking first name.
4. Use the phone preview on the right to check how the message reads with your samples in place.
5. Clear every error, read the warnings, then select **Submit to Meta**.

> An authentication template is different: Meta writes the message and the Copy code button for you, so the only things you set are the name, language, number and how many minutes the code stays valid (1 to 90).

## If something looks wrong

- **Submit to Meta is greyed out.** A line beside the button says why: no number chosen, no name, or errors in the checks.
- **The panel shows a rule you do not understand.** Each line names the field it belongs to (Name, Body, Footer and so on). Fix that field first.
- **The template was still refused.** The checks cannot predict every decision. See [Fix a rejected template](help:template-rejected-fix).
