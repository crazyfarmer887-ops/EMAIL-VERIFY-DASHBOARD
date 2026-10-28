# Scoped Disney mailbox delivery

The owner requests a new GButs Disney listing and private ID/password/email access delivery. Existing Tinyhost Disney and Netflix flows retain their formats and receipts. The new emailverify provider uses an exact-address mailbox plus six-digit PIN; the admin dashboard is never a buyer link.

Resend receiving stays the inbound source. After the existing mailbox authorization gate, an explicitly allowlisted address may refresh only recent Disney authentication mail through the existing server-held Resend key. Only one extracted six-digit code and a neutral subject/body are cached; receipts, welcome/payment messages, resets, other recipients and unrelated senders are excluded. No raw email or key goes to AI, logs or buyers. Parallel refreshes coalesce and successful lookups throttle 15 seconds. Existing PIN/rate limits and email rendering protections apply. Source API: https://resend.com/docs/api-reference/emails/list-received-emails and retrieve-received-email.

Activation: root-private RESEND_API_KEY and RESEND_DISNEY_MAILBOXES; set the exact mailbox PIN before delivering the link. Rollback disables the allowlist and restores previous application release. Verify synthetic cross-recipient/sender/expiry/reset cases and authenticated production empty/list response without sending a test buyer message.
