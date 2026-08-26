import requests
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from API.app import get_splice_credentials

creds = get_splice_credentials()
uuid_val = "fa41dccb9daec4a5ae30648fc12828e553343819634869582a09100581283273"

# Let's try passing uuids: [UUID] or asset_uuids: [UUID] inside the filter of assetsSearch
graphql_query = """query SamplesSearch($asset_uuids: [GUID!], $page: Int = 1, $limit: Int = 50) {
  assetsSearch(
    filter: {legacy: true, published: true, asset_type_slug: sample, asset_uuids: $asset_uuids}
    pagination: {page: $page, limit: $limit}
  ) {
    items {
      ... on IAsset {
        uuid
        name
        files {
          url
          asset_file_type_slug
        }
      }
    }
  }
}"""

payload = {
    "operationName": "SamplesSearch",
    "variables": {
        "asset_uuids": [uuid_val],
        "page": 1,
        "limit": 10
    },
    "query": graphql_query
}

headers = {
    "content-type": "application/json",
    "authorization": creds["authorization"],
    "cookie": creds["cookie"],
    "origin": "https://splice.com",
    "referer": "https://splice.com/"
}

res = requests.post("https://surfaces-graphql.splice.com/graphql", json=payload, headers=headers)
print("Filter uuids status:", res.status_code)
print("Filter uuids response:", res.json())
