import requests
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from API.app import get_splice_credentials

creds = get_splice_credentials()
uuid_val = "fa41dccb9daec4a5ae30648fc12828e553343819634869582a09100581283273"

graphql_query = """query SamplesSearch($query: String, $page: Int = 1, $limit: Int = 50) {
  assetsSearch(
    filter: {legacy: true, published: true, asset_type_slug: sample, query: $query}
    pagination: {page: $page, limit: $limit}
  ) {
    items {
      ... on IAsset {
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
      }
    }
  }
}"""

payload = {
    "operationName": "SamplesSearch",
    "variables": {
        "query": uuid_val,
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
print("Search Status:", res.status_code)
if res.status_code == 200:
    print("Search Results:", res.json())
