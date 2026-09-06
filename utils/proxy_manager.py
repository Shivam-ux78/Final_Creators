import itertools
from typing import Optional, List

class ProxyManager:
    """Manages rotating proxy list for HTTP requests."""
    def __init__(self, proxies: Optional[List[str]] = None):
        self.proxies = proxies or []
        self._cycler = itertools.cycle(self.proxies) if self.proxies else None

    def add_proxy(self, proxy_str: str):
        if proxy_str not in self.proxies:
            self.proxies.append(proxy_str)
            self._cycler = itertools.cycle(self.proxies)

    def get_proxy(self) -> Optional[dict]:
        if not self._cycler:
            return None
        proxy_url = next(self._cycler)
        return {
            "http": proxy_url,
            "https": proxy_url
        }

    def has_proxies(self) -> bool:
        return len(self.proxies) > 0
