# ==========================================
# 榜单数据巡检脚本
# ==========================================
from main import get_db
from models import ChartEntry
from sqlalchemy import func
from collections import defaultdict

db = next(get_db())

print("=" * 100)
print("📊 榜单数据统计")
print("=" * 100)

print("\n【1. 各榜单数据条数】\n")

charts = db.query(
    ChartEntry.platform,
    ChartEntry.chart_name,
    func.count(ChartEntry.id).label('count')
).group_by(
    ChartEntry.platform,
    ChartEntry.chart_name
).order_by(
    ChartEntry.platform,
    ChartEntry.chart_name
).all()

platform_totals = defaultdict(int)
grand_total = 0

for platform, chart_name, count in charts:
    print(f"  {platform:15s} / {chart_name:40s} : {count:3d} 条")
    platform_totals[platform] += count
    grand_total += count

print("\n" + "-" * 100)
print(f"  {'总计':58s} : {grand_total:3d} 条")
print("-" * 100)

print("\n【2. 各平台数据总数】\n")
for platform in sorted(platform_totals.keys()):
    print(f"  {platform:15s} : {platform_totals[platform]:3d} 条")

print("\n【3. 按类型统计】\n")

type_stats = db.query(
    ChartEntry.media_type,
    func.count(ChartEntry.id).label('count')
).group_by(
    ChartEntry.media_type
).all()

for media_type, count in type_stats:
    print(f"  {media_type:10s} : {count:3d} 条")

print("\n【4. 各榜单的类型分布】\n")

chart_type_stats = db.query(
    ChartEntry.platform,
    ChartEntry.chart_name,
    ChartEntry.media_type,
    func.count(ChartEntry.id).label('count')
).group_by(
    ChartEntry.platform,
    ChartEntry.chart_name,
    ChartEntry.media_type
).order_by(
    ChartEntry.platform,
    ChartEntry.chart_name,
    ChartEntry.media_type
).all()

current_chart = None
for platform, chart_name, media_type, count in chart_type_stats:
    chart_key = f"{platform} / {chart_name}"
    if chart_key != current_chart:
        if current_chart:
            print()
        print(f"  {chart_key}")
        current_chart = chart_key
    print(f"    └─ {media_type:10s} : {count:3d} 条")

print("\n【5. 数据质量检查】\n")

null_tmdb = db.query(func.count(ChartEntry.id)).filter(
    ChartEntry.tmdb_id == None
).scalar()
if null_tmdb > 0:
    print(f"  ⚠️  有 {null_tmdb} 条记录的 tmdb_id 为空")
else:
    print(f"  ✅ 所有记录都有 tmdb_id")

null_title = db.query(func.count(ChartEntry.id)).filter(
    ChartEntry.title == None
).scalar()
if null_title > 0:
    print(f"  ⚠️  有 {null_title} 条记录的 title 为空")
else:
    print(f"  ✅ 所有记录都有 title")

print("\n  检查重复条目：")
duplicates = db.query(
    ChartEntry.platform,
    ChartEntry.chart_name,
    ChartEntry.tmdb_id,
    func.count(ChartEntry.id).label('count')
).group_by(
    ChartEntry.platform,
    ChartEntry.chart_name,
    ChartEntry.tmdb_id
).having(
    func.count(ChartEntry.id) > 1
).all()

if duplicates:
    print(f"  ⚠️  发现 {len(duplicates)} 组重复数据：")
    for platform, chart_name, tmdb_id, count in duplicates[:10]:
        entries = db.query(ChartEntry).filter(
            ChartEntry.platform == platform,
            ChartEntry.chart_name == chart_name,
            ChartEntry.tmdb_id == tmdb_id
        ).all()
        print(f"    • {platform}/{chart_name} - tmdb_id={tmdb_id} ({entries[0].title}) 出现 {count} 次")
        for e in entries:
            print(f"      └─ Rank {e.rank}, ID={e.id}, created_at={e.created_at}")
else:
    print(f"  ✅ 没有发现重复数据")

print("\n【6. 各榜单完整数据】\n")

for platform, chart_name, _ in charts:
    print(f"  {platform} / {chart_name}")
    entries = db.query(ChartEntry).filter(
        ChartEntry.platform == platform,
        ChartEntry.chart_name == chart_name
    ).order_by(ChartEntry.rank).all()
    
    for e in entries:
        print(f"    {e.rank:2d}. {e.title:40s} (type={e.media_type}, tmdb_id={e.tmdb_id})")
    print()

print("\n【7. TV剧集出现频次统计（用于验证Top10，排除华语剧集榜）】\n")

tv_freq = db.query(
    ChartEntry.tmdb_id,
    ChartEntry.title,
    func.count(ChartEntry.id).label('freq'),
    func.min(ChartEntry.rank).label('best_rank')
).filter(
    ChartEntry.media_type == 'tv',
    ChartEntry.chart_name != '一周华语剧集口碑榜'
).group_by(
    ChartEntry.tmdb_id,
    ChartEntry.title
).order_by(
    func.count(ChartEntry.id).desc(),
    func.min(ChartEntry.rank).asc()
).limit(15).all()

print(f"  {'排名':<6} {'频次':<6} {'最佳排名':<10} {'标题':<40} {'TMDB ID'}")
print("  " + "-" * 90)
for idx, (tmdb_id, title, freq, best_rank) in enumerate(tv_freq, 1):
    print(f"  {idx:<6} {freq:<6} {best_rank:<10} {title:<40} {tmdb_id}")

print("\n【8. 电影出现频次统计（用于验证Top10）】\n")

movie_freq = db.query(
    ChartEntry.tmdb_id,
    ChartEntry.title,
    func.count(ChartEntry.id).label('freq'),
    func.min(ChartEntry.rank).label('best_rank')
).filter(
    ChartEntry.media_type == 'movie'
).group_by(
    ChartEntry.tmdb_id,
    ChartEntry.title
).order_by(
    func.count(ChartEntry.id).desc(),
    func.min(ChartEntry.rank).asc()
).limit(15).all()

print(f"  {'排名':<6} {'频次':<6} {'最佳排名':<10} {'标题':<40} {'TMDB ID'}")
print("  " + "-" * 90)
for idx, (tmdb_id, title, freq, best_rank) in enumerate(movie_freq, 1):
    print(f"  {idx:<6} {freq:<6} {best_rank:<10} {title:<40} {tmdb_id}")

print("\n" + "=" * 100)
print("✅ 查询完成")
print("=" * 100)

db.close()
