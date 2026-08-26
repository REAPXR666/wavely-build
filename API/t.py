import requests

url = "https://wavely.lol/api/search"
headers = {"X-API-Key": "wv_9f3b8855371896c51182e9e80ee8bb70e6521294"}
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
