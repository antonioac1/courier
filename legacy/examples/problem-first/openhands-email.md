# OpenHands Email Verification

**Problem:** OpenHands (formerly OpenDevin) agents need temporary email for autonomous web interactions.

**Solution:** Courier gives OpenHands agents email in one API call.

```bash
# In OpenHands bash:
curl -X POST https://getcourier.dev/alias   -H "Content-Type: application/json"   -d '{"purpose":"signup"}'

# Later:
curl -s https://getcourier.dev/messages | python3 -c "
import sys, json
d = json.load(sys.stdin)
for m in d.get('messages', []):
    if m.get('codes'):
        print(f'Code: {m["codes"]}')
"
```
