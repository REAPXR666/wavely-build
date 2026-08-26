import requests

url = "https://wavely.lol/api/search"
headers = {"X-API-Key": "wv_ecbbcf7d78b3f1145d2d9c61b4c3b082a782036c"}
params = {
    "q": "Synth lead",
    "category": "loop"
}

# 1. Fetch Search Results
response = requests.get(url, headers=headers, params=params)
data = response.json()

# 2. Extract Count & Results
total_found = data.get("count", 0)
samples = data.get("results", [])

print(f"Total samples found: {total_found}")
for i, sample in enumerate(samples):
    print(f"[{i+1}] {sample['name']} | BPM: {sample['bpm']} | Key: {sample['key']}")
