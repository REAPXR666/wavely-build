import requests
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from API.app import get_splice_credentials

creds = get_splice_credentials()

introspection_query = """
query IntrospectFilter {
  __type(name: "AssetFiltersInput") {
    name
    inputFields {
      name
      type {
        name
        kind
        ofType {
          name
          kind
        }
      }
    }
  }
}
"""

payload = {
    "operationName": "IntrospectFilter",
    "variables": {},
    "query": introspection_query
}

headers = {
    "content-type": "application/json",
    "authorization": creds["authorization"],
    "cookie": creds["cookie"],
    "origin": "https://splice.com",
    "referer": "https://splice.com/"
}

res = requests.post("https://surfaces-graphql.splice.com/graphql", json=payload, headers=headers)
print("Introspection Status:", res.status_code)
if res.status_code == 200:
    fields = res.json().get("data", {}).get("__type", {}).get("inputFields", [])
    print("AssetFiltersInput Fields:")
    for f in fields:
        print(f"  - {f['name']}")
