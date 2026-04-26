from models import SessionLocal, ChartEntry, PublicChartEntry, ChartConfig

LEGACY_PLATFORM_NAME_MAP = {
    "烂番茄": "Rotten Tomatoes",
    "MTC": "Metacritic",
}

LEGACY_CHART_NAME_MAP = {
    "Top 10 on IMDb this week": "IMDb 本周 Top 10",
    "Popular Streaming Movies": "热门流媒体电影",
    "Popular TV": "热门剧集",
    "Trending Movies This Week": "本周趋势电影",
    "Trending Shows This Week": "本周趋势剧集",
    "Popular films this week": "本周热门影视",
    "趋势本周": "本周趋势影视",
    "Top TV Shows Last Week": "上周剧集 Top 榜",
    "Top Movies Last Week": "上周电影 Top 榜",
    "IMDb Top 250 Movies": "IMDb 电影 Top 250",
    "IMDb Top 250 TV Shows": "IMDb 剧集 Top 250",
    "Letterboxd Official Top 250": "Letterboxd 电影 Top 250",
    "豆瓣 Top 250": "豆瓣 电影 Top 250",
    "Metacritic Best Movies of All Time": "Metacritic 史上最佳电影 Top 250",
    "Metacritic Best TV Shows of All Time": "Metacritic 史上最佳剧集 Top 250",
    "TMDB Top 250 Movies": "TMDB 高分电影 Top 250",
    "TMDB Top 250 TV Shows": "TMDB 高分剧集 Top 250",
}


def migrate() -> None:
    db = SessionLocal()
    try:
        for old, new in LEGACY_PLATFORM_NAME_MAP.items():
            db.query(ChartEntry).filter(ChartEntry.platform == old).update({"platform": new}, synchronize_session=False)
            db.query(PublicChartEntry).filter(PublicChartEntry.platform == old).update({"platform": new}, synchronize_session=False)
            db.query(ChartConfig).filter(ChartConfig.platform == old).update({"platform": new}, synchronize_session=False)
        for old, new in LEGACY_CHART_NAME_MAP.items():
            db.query(ChartEntry).filter(ChartEntry.chart_name == old).update({"chart_name": new}, synchronize_session=False)
            db.query(PublicChartEntry).filter(PublicChartEntry.chart_name == old).update({"chart_name": new}, synchronize_session=False)
            db.query(ChartConfig).filter(ChartConfig.chart_name == old).update({"chart_name": new}, synchronize_session=False)
        db.commit()
        print("Migration completed.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    migrate()
