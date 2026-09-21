"""Prüfungen des Entwicklungsservers.

Geprüft wird die Auskunft über die eigenen Adressen. Das klingt nebensächlich,
war aber im Test die Ursache einer verlorenen halben Stunde: bei aktivem VPN
nannte der Server die Tunneladresse, und die ist vom Telefon im WLAN nicht
erreichbar. Die Textverarbeitung ist deshalb eigens prüfbar gebaut — ohne Netz,
ohne Betriebssystemabhängigkeit.
"""

from __future__ import annotations

import unittest

from postbuch.server import _einordnung, schnittstellen_aus_text

IFCONFIG_MACOS = """lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384
\tinet 127.0.0.1 netmask 0xff000000
en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
\tether aa:bb:cc:dd:ee:ff
\tinet6 fe80::1cbd:4bff:fe3a:1%en0 prefixlen 64 secured scopeid 0xb
\tinet 192.168.178.43 netmask 0xffffff00 broadcast 192.168.178.255
utun4: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1400
\tinet 10.231.244.59 --> 10.231.244.59 netmask 0xffffffff
"""

IP_LINUX = (
    "1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever\n"
    "2: eth0    inet 192.168.1.20/24 brd 192.168.1.255 scope global eth0\\   valid_lft forever\n"
    "3: wg0    inet 10.8.0.2/32 scope global wg0\\       valid_lft forever\n"
)


class Schnittstellen(unittest.TestCase):
    def test_ifconfig_der_macos_form(self):
        self.assertEqual(
            schnittstellen_aus_text(IFCONFIG_MACOS),
            [("en0", "192.168.178.43"), ("utun4", "10.231.244.59")],
        )

    def test_ip_der_linux_form(self):
        self.assertEqual(
            schnittstellen_aus_text(IP_LINUX),
            [("eth0", "192.168.1.20"), ("wg0", "10.8.0.2")],
        )

    def test_rueckkanal_bleibt_aussen_vor(self):
        """127.0.0.1 ist keine Adresse, die ein anderes Gerät erreichen kann."""
        for text in (IFCONFIG_MACOS, IP_LINUX):
            for _, adresse in schnittstellen_aus_text(text):
                self.assertFalse(adresse.startswith("127."))

    def test_leerer_text_ergibt_nichts(self):
        self.assertEqual(schnittstellen_aus_text(""), [])
        self.assertEqual(schnittstellen_aus_text("kein Netz\nirgendwas"), [])

    def test_einordnung_benennt_tunnel_und_lokales_netz(self):
        self.assertIn("VPN", _einordnung("utun4"))
        self.assertIn("VPN", _einordnung("wg0"))
        self.assertIn("VPN", _einordnung("ipsec0"))
        self.assertIn("lokales Netz", _einordnung("en0"))
        self.assertIn("lokales Netz", _einordnung("wlan0"))
        self.assertEqual(_einordnung("bridge100"), "unklar")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
