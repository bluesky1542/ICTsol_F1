import os
import unittest
from unittest.mock import patch

from app.database import database


class DatabaseConfigTest(unittest.TestCase):
    def test_public_server_requires_external_database(self):
        with patch.dict(os.environ, {"DATABASE_URL": "", "REQUIRE_DATABASE_URL": "1"}):
            with self.assertRaises(RuntimeError):
                with database():
                    self.fail("設定不足のままSQLiteへ保存してはいけません。")

    def test_invalid_external_url_does_not_fall_back_to_sqlite(self):
        with patch.dict(os.environ, {"DATABASE_URL": "https://invalid.example/", "REQUIRE_DATABASE_URL": "0"}):
            with self.assertRaises(ValueError):
                with database():
                    self.fail("接続設定の誤りでSQLiteへ切り替えてはいけません。")
