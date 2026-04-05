import json
from algosdk.v2client import algod
import base64
import ssl
import urllib.request

ssl_context = ssl._create_unverified_context()
urllib.request.install_opener(urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl_context)))

client = algod.AlgodClient('', 'https://testnet-api.algonode.cloud')

# Options Pool
app_id = 758189781
info = client.application_info(app_id)

print(f"App ID: {app_id}")
for state in info['params']['global-state']:
    key = base64.b64decode(state['key']).decode('utf-8', errors='replace')
    value = state['value'].get('uint', state['value'].get('bytes', ''))
    print(f"  {key}: {value}")
