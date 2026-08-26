import os
import sys
import random
import requests

# Append API directory to path to import helper functions
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'API'))

from app import descramble_splice_mp3, search_splice_max

def main():
    query = "DS_S2OT_150_synth_lead_faster_C"
    print(f"Searching Splice for: '{query}'...")
    try:
        results = search_splice_max(query)
    except Exception as e:
        print(f"Error searching Splice: {e}")
        return
        
    if not results:
        print("No results found.")
        return
        
    print(f"Found {len(results)} samples.")
    
    # Pick a random sample
    sample = random.choice(results)
    print(f"\nSelected random sample:")
    print(f"  Name: {sample['name']}")
    print(f"  UUID: {sample['uuid']}")
    print(f"  Pack: {sample['pack']}")
    print(f"  BPM: {sample['bpm']}")
    print(f"  Key: {sample['key']}")
    print(f"  Preview URL: {sample['previewUrl']}")
    print(f"  Decrypted URL path: {sample['decryptedAudioUrl']}")
    
    # Download and descramble
    print("\nDownloading and descrambling sample audio...")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://splice.com/',
        'Origin': 'https://splice.com'
    }
    
    try:
        res = requests.get(sample['previewUrl'], headers=headers, timeout=15)
        if res.status_code != 200:
            print(f"Failed to download audio file: HTTP {res.status_code}")
            return
            
        clean_mp3 = descramble_splice_mp3(res.content)
        
        # Write to sample.mp3 at workspace root
        output_filename = "sample.mp3"
        with open(output_filename, "wb") as f:
            f.write(clean_mp3)
            
        print(f"\n[SUCCESS] Decrypted audio successfully saved to {os.path.abspath(output_filename)}")
        
    except Exception as e:
        print(f"Error downloading or decrypting sample: {e}")

if __name__ == "__main__":
    main()
