"""Create the CT Workbook Pro PayPal product and billing plans.

$9.99 CAD/month and $79.99 CAD/year, no tax (CRA small-supplier exemption).
Run once per environment, then set the printed IDs on the API service:
    PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... PAYPAL_ENV=sandbox|live python scripts_paypal_setup.py
"""
import os
import sys

import requests

ENV = os.environ.get("PAYPAL_ENV", "sandbox").lower()
BASE = "https://api-m.paypal.com" if ENV == "live" else "https://api-m.sandbox.paypal.com"
CLIENT_ID = os.environ["PAYPAL_CLIENT_ID"]
CLIENT_SECRET = os.environ["PAYPAL_CLIENT_SECRET"]

PLANS = [
    {"env": "PAYPAL_PLAN_MONTHLY", "lookup_key": "ct_pro_monthly", "name": "CT Workbook Pro - Monthly",
     "amount": "9.99", "unit": "MONTH"},
    {"env": "PAYPAL_PLAN_YEARLY", "lookup_key": "ct_pro_yearly", "name": "CT Workbook Pro - Yearly",
     "amount": "79.99", "unit": "YEAR"},
]


def main():
    token = requests.post(f"{BASE}/v1/oauth2/token", auth=(CLIENT_ID, CLIENT_SECRET),
                          data={"grant_type": "client_credentials"}, timeout=30)
    token.raise_for_status()
    headers = {"Authorization": f"Bearer {token.json()['access_token']}", "Content-Type": "application/json"}

    product = requests.post(f"{BASE}/v1/catalogs/products", headers={**headers, "PayPal-Request-Id": "ct-workbook-pro-product"},
                            json={"name": "CT Workbook Pro", "type": "SERVICE", "category": "SOFTWARE"}, timeout=30)
    product.raise_for_status()
    product_id = product.json()["id"]
    print(f"Product: {product_id} ({ENV})")

    for plan in PLANS:
        r = requests.post(f"{BASE}/v1/billing/plans", headers={**headers, "PayPal-Request-Id": f"ct-{plan['lookup_key']}-{product_id}"}, json={
            "product_id": product_id,
            "name": plan["name"],
            "status": "ACTIVE",
            "billing_cycles": [{
                "frequency": {"interval_unit": plan["unit"], "interval_count": 1},
                "tenure_type": "REGULAR",
                "sequence": 1,
                "total_cycles": 0,
                "pricing_scheme": {"fixed_price": {"value": plan["amount"], "currency_code": "CAD"}},
            }],
            "payment_preferences": {
                "auto_bill_outstanding": True,
                "setup_fee_failure_action": "CONTINUE",
                "payment_failure_threshold": 3,
            },
            "taxes": {"percentage": "0", "inclusive": False},
        }, timeout=30)
        if not r.ok:
            print(r.text, file=sys.stderr)
            r.raise_for_status()
        print(f"{plan['env']}={r.json()['id']}   # ${plan['amount']} CAD / {plan['unit'].lower()}")


if __name__ == "__main__":
    main()
