# ==========================================
# 生成 sitemap.xml 模块
# ==========================================
from datetime import datetime, timezone
from dotenv import load_dotenv
import os

load_dotenv()
SITEMAP_FILE_PATH = os.getenv("SITEMAP_FILE_PATH")

def generate_sitemap():
    lastmod = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    urls = [
        {"loc": "https://ratefuse.cn/", "changefreq": "daily", "priority": "1.0"},
        {"loc": "https://ratefuse.cn/charts", "changefreq": "daily", "priority": "0.9"},
    ]

    sitemap_items = ""
    for item in urls:
        sitemap_items += f"""
    <url>
        <loc>{item['loc']}</loc>
        <lastmod>{lastmod}</lastmod>
        <changefreq>{item['changefreq']}</changefreq>
        <priority>{item['priority']}</priority>
    </url>"""

    sitemap_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{sitemap_items}
</urlset>"""

    with open(SITEMAP_FILE_PATH, "w", encoding="utf-8") as f:
        f.write(sitemap_xml)


if __name__ == "__main__":
    generate_sitemap()
    
