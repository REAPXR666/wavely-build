# Stripe setup for Wavely

The codebase is ready for Stripe Checkout subscriptions. Complete these account-side steps before accepting payments.

## 1. Create the recurring prices

In Stripe, create one product named **Wavely Pro** with two recurring prices:

- Monthly: **$4.99 USD**, billed monthly
- Annual: **$45.00 USD**, billed yearly

Copy both `price_...` IDs into your local `.env` file using `.env.example` as the template.

## 2. Add the API credentials

Copy `.env.example` to `.env` and set:

- `WAVELY_SECRET_KEY`: a long random value used to protect account sessions
- `APP_BASE_URL`: the canonical public HTTPS origin, such as `https://wavely.lol`
- `STRIPE_SECRET_KEY`: your Stripe secret key
- `STRIPE_MONTHLY_PRICE_ID`: the monthly recurring Price ID
- `STRIPE_ANNUAL_PRICE_ID`: the annual recurring Price ID

Start with Stripe test-mode values. Never commit `.env`; it is ignored by Git.

## 3. Register the webhook

In Stripe Workbench, register this HTTPS endpoint:

`https://YOUR-DOMAIN/api/stripe/webhook`

Subscribe it to these event types:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`

Copy its `whsec_...` signing secret to `STRIPE_WEBHOOK_SECRET` in `.env`.

## 4. Test before going live

Use Stripe test mode to confirm all of the following:

1. Monthly and annual checkout redirect to Stripe with the correct price.
2. A completed test payment activates Pro on the Wavely dashboard.
3. The invoice appears in billing history once and only once.
4. A failed renewal removes active access.
5. Disabling auto-renew schedules cancellation at the end of the paid period.
6. Replayed webhook events do not duplicate payments or subscriptions.

When the flow passes, replace the test secret, Price IDs, and webhook secret with the live-mode values. Live mode requires an HTTPS `APP_BASE_URL`.
