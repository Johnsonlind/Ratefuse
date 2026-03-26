// ==========================================
// 评分数据 API 服务
// ==========================================
export async function fetchTMDBRating(mediaType: 'movie' | 'tv', id: string) {
  try {
    const response = await fetch(`/api/ratings/tmdb/${mediaType}/${id}`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error('获取 TMDB 评分失败:', error);
    return null;
  }
}

export async function fetchTraktRating(mediaType: 'movies' | 'shows', tmdbId: string) {
  try {
    const type = mediaType === 'movies' ? 'movie' : 'tv';
    const response = await fetch(`/api/ratings/trakt/${type}/${tmdbId}`);
    
    if (!response.ok) {
      console.warn(`后端Trakt API返回错误: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    if (data.status !== 'Successful') {
      console.warn(`Trakt评分获取失败: ${data.status}`);
      return null;
    }
    
    const result: any = {
      rating: parseFloat(data.rating) || 0,
      votes: parseInt(data.votes) || 0,
      distribution: data.distribution || {}
    };
    
    if (type === 'tv' && data.seasons) {
      result.seasons = data.seasons.map((season: any) => ({
        season_number: season.season_number,
        rating: parseFloat(season.rating) || 0,
        votes: parseInt(season.votes) || 0,
        distribution: season.distribution || {}
      }));
      console.log(`获取到 ${result.seasons.length} 季的Trakt评分`);
    } else if (type === 'tv') {
      result.seasons = [{
        season_number: 1,
        rating: parseFloat(data.rating) || 0,
        votes: parseInt(data.votes) || 0,
        distribution: data.distribution || {}
      }];
      console.log('使用整体评分作为第1季评分');
    }
    
    return result;
  } catch (error) {
    console.error('获取Trakt评分失败:', error);
    return null;
  }
}
