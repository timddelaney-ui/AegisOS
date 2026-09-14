"""Setup Stripe catalog: $5/month or $60/year subscription plans."""
import os, stripe
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

CATALOG = [
    {
        "emergent_product_id": "ct_workbook_pro",
        "name": "CT Workbook Pro",
        "tax_code": "txcd_10103001",  # SaaS
        "prices": [
            {"lookup_key": "ct_pro_monthly", "amount": 500,  "currency": "usd", "interval": "month"},
            {"lookup_key": "ct_pro_yearly",  "amount": 6000, "currency": "usd", "interval": "year"},
        ],
    },
]

def get_or_create_product(entry):
    for p in stripe.Product.list(active=True, limit=100).auto_paging_iter():
        if p.to_dict().get("metadata", {}).get("emergent_product_id") == entry["emergent_product_id"]:
            print(f"Found existing product: {p.id}")
            return p
    return stripe.Product.create(
        name=entry["name"],
        tax_code=entry.get("tax_code"),
        metadata={"managed_by": "emergent", "emergent_product_id": entry["emergent_product_id"]},
    )

for entry in CATALOG:
    product = get_or_create_product(entry)
    print(f"Product: {product.id} - {product.name}")
    for p in entry["prices"]:
        existing = stripe.Price.list(lookup_keys=[p["lookup_key"]], active=True, limit=1).data
        if existing and (existing[0].unit_amount != p["amount"] or existing[0].currency != p["currency"]):
            stripe.Price.modify(existing[0].id, active=False)
            existing = []
        if not existing:
            kwargs = dict(
                product=product.id,
                unit_amount=p["amount"],
                currency=p["currency"],
                lookup_key=p["lookup_key"],
                transfer_lookup_key=True,
                recurring={"interval": p["interval"]},
            )
            price = stripe.Price.create(**kwargs)
            print(f"  Created price: {price.id} ({p['lookup_key']}) - ${p['amount']/100}/{p['interval']}")
        else:
            print(f"  Price exists: {existing[0].id} ({p['lookup_key']})")

# Country check
acct = stripe.Account.retrieve()
print(f"\nAccount country: {acct.get('country')}")
print("Catalog setup complete.")
