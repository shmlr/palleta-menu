"""Synthetic Gmail RAW security tests; never use real Palleta XLS in public CI."""
import base64
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.parser import BytesParser
from email import policy
import unittest

from tools.fetch_gmail_minmax import SourceError, extract_report

MSK = timezone(timedelta(hours=3))
SENT = datetime(2026, 10, 15, 19, 7, 3, tzinfo=MSK)
XLS = bytes.fromhex("D0CF11E0A1B11AE1") + bytes(128)
NAME = "Отчет_Паллета 1С - Меню_2026-10-15 19-06-58.xls"
AUTH = "mx.google.com; dkim=pass header.i=@yandex.ru header.s=mail; spf=pass smtp.mailfrom=palleta.store@yandex.ru; dmarc=pass header.from=yandex.ru"


def make_message(sender="palleta.store@yandex.ru", subject="Паллета 1С - Меню", auth=AUTH, name=NAME, binary=XLS, extra=False):
    mail = EmailMessage()
    mail["From"] = sender
    mail["To"] = "test@gmail.com"
    mail["Subject"] = subject
    if auth is not None:
        mail["Authentication-Results"] = auth
    mail.set_content("Synthetic daily min-max")
    mail.add_attachment(binary, maintype="application", subtype="octet-stream", filename=name)
    if extra:
        mail.add_attachment(binary, maintype="application", subtype="octet-stream", filename=name)
    return base64.urlsafe_b64encode(mail.as_bytes()).decode(), int(SENT.timestamp() * 1000)


class GmailMinmaxTest(unittest.TestCase):
    def test_legitimate_raw_mime(self):
        raw, ts = make_message()
        print("SYNTHETIC_FILENAME_DEBUG", [repr(p.get_filename()) for p in BytesParser(policy=policy.default).parsebytes(base64.urlsafe_b64decode(raw)).walk() if p.get_filename()])
        name, binary, arrive, captured = extract_report(raw, ts)
        self.assertEqual(name, NAME)
        self.assertEqual(binary, XLS)
        self.assertEqual(arrive, SENT.isoformat(timespec="seconds"))
        self.assertEqual(captured, "2026-10-15T19:06:58+03:00")

    def test_wrong_sender(self):
        raw, ts = make_message(sender="attacker@example.com")
        with self.assertRaisesRegex(SourceError, "sender"):
            extract_report(raw, ts)

    def test_authentication_absent(self):
        raw, ts = make_message(auth=None)
        with self.assertRaisesRegex(SourceError, "authentication"):
            extract_report(raw, ts)

    def test_authentication_spoof_mismatch(self):
        raw, ts = make_message(auth="mx.google.com; dkim=fail; spf=pass smtp.mailfrom=attacker.com; dmarc=fail")
        with self.assertRaisesRegex(SourceError, "authentication"):
            extract_report(raw, ts)

    def test_wrong_subject(self):
        raw, ts = make_message(subject="Another mail")
        with self.assertRaisesRegex(SourceError, "subject"):
            extract_report(raw, ts)

    def test_wrong_extension(self):
        raw, ts = make_message(name="123.xls")
        with self.assertRaisesRegex(SourceError, "filename"):
            extract_report(raw, ts)

    def test_two_attachments(self):
        raw, ts = make_message(extra=True)
        with self.assertRaisesRegex(SourceError, "exactly one"):
            extract_report(raw, ts)

    def test_not_binary_xls(self):
        raw, ts = make_message(binary=b"test.xlsx data")
        with self.assertRaisesRegex(SourceError, "BIFF8"):
            extract_report(raw, ts)

    def test_wrong_timestamp(self):
        raw, ts = make_message()
        with self.assertRaisesRegex(SourceError, "timestamp differ"):
            extract_report(raw, ts + 3600000)

    def test_broken_base64(self):
        with self.assertRaisesRegex(SourceError, "base64"):
            extract_report("invalid/raw^", int(SENT.timestamp() * 1000))


if __name__ == "__main__":
    unittest.main()
