"""SMTP test helper.

Usage:
  set SMTP_HOST=smtp.example.com
  set SMTP_PORT=465
  set SMTP_USER=your_account@example.com
  set SMTP_PASS=your_password
  set SMTP_TO=receiver@example.com
  python test_mail_send.py
"""
import os
import smtplib
from email.mime.text import MIMEText

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.example.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
SMTP_TO = os.environ.get("SMTP_TO", SMTP_USER)

if not all([SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_TO]):
    raise SystemExit("SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_TO 환경변수를 설정하세요.")

msg = MIMEText("대시보드 SMTP 테스트 메일입니다.", "plain", "utf-8")
msg["Subject"] = "Dashboard SMTP Test"
msg["From"] = SMTP_USER
msg["To"] = SMTP_TO

with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20) as server:
    server.login(SMTP_USER, SMTP_PASS)
    server.sendmail(SMTP_USER, [SMTP_TO], msg.as_string())

print("SMTP test mail sent")
