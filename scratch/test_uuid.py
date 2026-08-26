import requests
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from API.app import get_splice_credentials

creds = get_splice_credentials()
uuid_val = "085bd422-bf47-4144-9c9d-a74ee502c368"

# Let's try querying using the single asset query
q_single = """
query GetAsset($uuid: GUID!) {
  asset(uuid: $uuid) {
    ... on SampleAsset {
      bpm
      chord_type
      key
      duration
      uuid
      name
      files {
        uuid
        name
        hash
        path
        asset_file_type_slug
        url
      }
      parents(filter: {asset_type_slug: pack}) {
        items {
          ... on PackAsset {
            uuid
            name
            files {
              uuid
              path
              asset_file_type_slug
              url
            }
          }
        }
      }
    }
  }
}
"""

payload = {
    "operationName": "GetAsset",
    "variables": {
        "uuid": uuid_val
    },
    "query": q_single
}

headers = {
    "content-type": "application/json",
    "authorization": creds["authorization"],
    "cookie": creds["cookie"],
    "origin": "https://splice.com",
    "referer": "https://splice.com/"
}

res = requests.post("https://surfaces-graphql.splice.com/graphql", json=payload, headers=headers)
print("Single Asset Status:", res.status_code)
if res.status_code == 200:
    print("Single Asset JSON:", res.json())
