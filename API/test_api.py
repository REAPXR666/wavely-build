import os
import sys
import struct

# Append folder path for import
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app import descramble_splice_mp3, get_splice_credentials, search_splice_max

def test_descrambler():
    print("[Test] Running XOR descrambler validation...")
    
    # Construct a mock scrambled payload:
    # byte 0-1: header (dummy)
    # byte 2-9: e (64-bit integer, e.g., 5)
    # byte 10-27: key_bytes (length 18)
    # byte 28+: scrambled payload (XOR'd by key_bytes)
    
    e = 5
    key = b"123456789012345678"  # 18 bytes
    
    # Original clean body: "hello world! welcome to wavely api descrambler test" (length 51)
    clean_body = b"hello world! welcome to wavely api descrambler test"
    
    # Scramble:
    # Block 1 (0 to e=5): clean_body[i] ^ key[i%18]
    # Block 2 (e=5 to 2*e=10): untouched
    # Block 3 (2*e=10 to 3*e=15): clean_body[i] ^ key[(i - 2*e)%18]
    # Block 4 (3*e=15+): untouched
    
    scrambled_body = bytearray(clean_body)
    for i in range(min(e, len(clean_body))):
        scrambled_body[i] ^= key[i % 18]
        
    start3 = 2 * e
    end3 = min(3 * e, len(clean_body))
    for i in range(start3, end3):
        scrambled_body[i] ^= key[(i - start3) % 18]
        
    # Build complete scrambled mock file
    mock_file = bytearray(28 + len(clean_body))
    mock_file[0:2] = b"\x00\x00"
    mock_file[2:10] = struct.pack('<Q', e)
    mock_file[10:28] = key
    mock_file[28:] = scrambled_body
    
    # Decrypt
    decrypted = descramble_splice_mp3(bytes(mock_file))
    
    print(f"  Clean:     {clean_body}")
    print(f"  Decrypted: {decrypted}")
    
    assert decrypted == clean_body, "Decryption output mismatch!"
    print("[OK] XOR Descrambler verification passed successfully!")

def test_credentials():
    print("[Test] Verifying credentials loader...")
    creds = get_splice_credentials()
    assert creds is not None
    assert "cookie" in creds
    assert "authorization" in creds
    print("[OK] Credentials loader verification passed!")

if __name__ == "__main__":
    try:
        test_descrambler()
        test_credentials()
        print("\nAll offline tests passed successfully!")
    except Exception as e:
        print(f"\n[FAIL] Test failed: {e}")
        sys.exit(1)
