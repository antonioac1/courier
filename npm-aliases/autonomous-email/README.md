# autonomous-email

Autonomous email handling for AI agents. Receive OTP codes, magic links, and verification emails without human intervention. No signup.

**This is an alias package.** The underlying project is Courier.

A single call creates a disposable inbox that receives real SMTP email and automatically extracts verification codes and links.

```
POST /alias -> curl + api -> disposable inbox -> receive email -> extract OTP -> continue execution
```
