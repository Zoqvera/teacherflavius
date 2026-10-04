from __future__ import annotations

import json
import unittest
from pathlib import Path

from scripts.prepare_android_web import prepare_native_payment_page

ROOT = Path(__file__).resolve().parents[1]


class GooglePlayReadinessTests(unittest.TestCase):
    def test_store_listing_respects_play_metadata_limits(self) -> None:
        listing = json.loads(
            (ROOT / "mobile" / "google_play_listing_pt_BR.json").read_text(
                encoding="utf-8"
            )
        )

        self.assertLessEqual(len(listing["appName"]), 30)
        self.assertLessEqual(len(listing["shortDescription"]), 80)
        self.assertLessEqual(len(listing["fullDescription"]), 4000)
        self.assertNotIn("online", listing["fullDescription"].lower())
        self.assertEqual(listing["category"], "Education")

    def test_privacy_and_deletion_resources_use_public_policy(self) -> None:
        listing = json.loads(
            (ROOT / "mobile" / "google_play_listing_pt_BR.json").read_text(
                encoding="utf-8"
            )
        )
        policy = (ROOT / "privacidade" / "index.html").read_text(encoding="utf-8")

        self.assertEqual(
            listing["privacyPolicyUrl"],
            "https://teacherflavius.com/privacidade/",
        )
        self.assertEqual(
            listing["accountDeletionUrl"],
            "https://teacherflavius.com/privacidade/",
        )
        self.assertIn("Exclusão de conta e dados", policy)
        self.assertIn("solicitar atendimento pelo WhatsApp", policy)

    def test_android_payment_page_is_read_only_without_changing_web_checkout(self) -> None:
        source = (ROOT / "pagamento" / "index.html").read_text(encoding="utf-8")
        android = prepare_native_payment_page(source)

        self.assertIn("sdk.mercadopago.com", source)
        self.assertIn("subscription_checkout.js", source)
        self.assertNotIn("sdk.mercadopago.com", android)
        self.assertNotIn("subscription_checkout.js", android)
        self.assertIn("Consulte suas mensalidades", android)

    def test_data_safety_draft_documents_account_deletion(self) -> None:
        declaration = json.loads(
            (ROOT / "mobile" / "google_play_data_safety.json").read_text(
                encoding="utf-8"
            )
        )

        self.assertTrue(declaration["encryptionInTransit"])
        self.assertTrue(declaration["accountDeletion"]["availableInApp"])
        self.assertTrue(declaration["accountDeletion"]["retentionDisclosure"])
        self.assertIn(
            "https://teacherflavius.com/privacidade/",
            declaration["accountDeletion"]["externalResource"],
        )


if __name__ == "__main__":
    unittest.main()
