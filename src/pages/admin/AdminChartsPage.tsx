// ==========================================
// 管理端榜单管理页
// ==========================================
import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../../modules/auth/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ThemeToggle } from '../../shared/ui/ThemeToggle';
import { useDebounce } from '../../shared/hooks/useDebounce';
import { CardTabs } from '../../shared/ui/CardTabs';
import { adminSearchMedia } from '../../api/adminSearch';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { formatChinaDateTime } from '../../shared/utils/time';
import { posterPathToSiteUrl } from '../../api/image';

interface MediaItem {
  id: number;
  type: 'movie' | 'tv';
  title: string;
  poster: string;
  year?: number;
}

type SectionType = 'movie' | 'tv' | 'both';

// 平台logo映射（与前台榜单页保持一致）
const PLATFORM_LOGOS: Record<string, string> = {
  '豆瓣': '/logos/douban.png',
  'IMDb': '/logos/imdb.png',
  '烂番茄': '/logos/rottentomatoes.png',
  'Rotten Tomatoes': '/logos/rottentomatoes.png',
  'MTC': '/logos/metacritic.png',
  'Metacritic': '/logos/metacritic.png',
  'Letterboxd': '/logos/letterboxd.png',
  'TMDB': '/logos/tmdb.png',
  'Trakt': '/logos/trakt.png',
};

// 平台顺序
const CHART_STRUCTURE: Array<{ platform: string; sections: Array<{ name: string; media_type: SectionType }> }> = [
  { platform: '豆瓣', sections: [
    { name: '一周口碑榜', media_type: 'movie' },
    { name: '一周华语剧集口碑榜', media_type: 'tv' },
    { name: '一周全球剧集口碑榜', media_type: 'tv' },
    { name: '豆瓣 电影 Top 250', media_type: 'movie' },
    { name: '豆瓣2025评分最高华语电影', media_type: 'movie' },
    { name: '豆瓣2025评分最高外语电影', media_type: 'movie' },
    { name: '豆瓣2025冷门佳片', media_type: 'movie' },
    { name: '豆瓣2025评分最高日本电影', media_type: 'movie' },
    { name: '豆瓣2025评分最高韩国电影', media_type: 'movie' },
    { name: '豆瓣2025评分最高喜剧片', media_type: 'movie' },
    { name: '豆瓣2025评分最高爱情片', media_type: 'movie' },
    { name: '豆瓣2025评分最高恐怖片', media_type: 'movie' },
    { name: '豆瓣2025评分最高动画片', media_type: 'movie' },
    { name: '豆瓣2025评分最高纪录片', media_type: 'movie' },
    { name: '豆瓣2026最值得期待华语电影', media_type: 'movie' },
    { name: '豆瓣2026最值得期待外语电影', media_type: 'movie' },
    { name: '豆瓣2025评分最高华语剧集', media_type: 'tv' },
    { name: '豆瓣2025评分最高英美新剧', media_type: 'tv' },
    { name: '豆瓣2025评分最高英美续订剧', media_type: 'tv' },
    { name: '豆瓣2025评分最高日本剧集', media_type: 'tv' },
    { name: '豆瓣2025评分最高韩国剧集', media_type: 'tv' },
    { name: '豆瓣2025评分最受关注综艺', media_type: 'tv' },
    { name: '豆瓣2025评分最高动画剧集', media_type: 'tv' },
    { name: '豆瓣2025评分最高大陆微短剧', media_type: 'tv' },
    { name: '豆瓣2025评分最高纪录剧集', media_type: 'tv' },
    { name: '豆瓣2026最值得期待剧集', media_type: 'tv' },
    { name: '豆瓣2025评分月度热搜影视', media_type: 'both' },
  ]},
  { platform: 'IMDb', sections: [
    { name: 'IMDb 本周 Top 10', media_type: 'both' },
    { name: 'IMDb 2025最受欢迎电影', media_type: 'movie' },
    { name: 'IMDb 2025最受欢迎剧集', media_type: 'tv' },
    { name: 'IMDb 工作人员2025最喜爱的电影', media_type: 'movie' },
    { name: 'IMDb 工作人员2025最喜爱的剧集', media_type: 'tv' },
    { name: 'IMDb 电影 Top 250', media_type: 'movie' },
    { name: 'IMDb 剧集 Top 250', media_type: 'tv' },
  ]},
  { platform: 'Rotten Tomatoes', sections: [
    { name: '热门流媒体电影', media_type: 'movie' },
    { name: '热门剧集', media_type: 'tv' },
    { name: 'Rotten Tomatoes 2025 最佳电影', media_type: 'movie' },
    { name: 'Rotten Tomatoes 2025 最佳剧集', media_type: 'tv' },
  ]},
  { platform: 'Metacritic', sections: [
    { name: '本周趋势电影', media_type: 'movie' },
    { name: '本周趋势剧集', media_type: 'tv' },
    { name: 'Metacritic 2025 最佳电影', media_type: 'movie' },
    { name: 'Metacritic 2025 最佳剧集', media_type: 'tv' },
    { name: 'Metacritic 史上最佳电影 Top 250', media_type: 'movie' },
    { name: 'Metacritic 史上最佳剧集 Top 250', media_type: 'tv' },
  ]},
  { platform: 'Letterboxd', sections: [
    { name: '本周热门影视', media_type: 'both' },
    { name: 'Letterboxd 2025 Top 50', media_type: 'both' },
    { name: 'Letterboxd 电影 Top 250', media_type: 'movie' },
  ]},
  { platform: 'TMDB', sections: [
    { name: '本周趋势影视', media_type: 'both' },
    { name: 'TMDB 高分电影 Top 250', media_type: 'movie' },
    { name: 'TMDB 高分剧集 Top 250', media_type: 'tv' },
  ]},
  { platform: 'Trakt', sections: [
    { name: '上周电影 Top 榜', media_type: 'movie' },
    { name: '上周剧集 Top 榜', media_type: 'tv' },
  ]},
];

// Top 250 榜单列表（需要单独更新）
const TOP_250_CHARTS = [
  'IMDb 电影 Top 250',
  'IMDb 剧集 Top 250',
  'Letterboxd 电影 Top 250',
  '豆瓣 电影 Top 250',
  'Metacritic 史上最佳电影 Top 250',
  'Metacritic 史上最佳剧集 Top 250',
  'TMDB 高分电影 Top 250',
  'TMDB 高分剧集 Top 250',
];

// 已改为手动录入的榜单（不显示"更新 Top 250"按钮）
const MANUAL_ONLY_CHARTS: string[] = [];

// 支持手动录入的榜单（即使也支持自动抓取，仍可手动录入）
const MANUAL_ENTRY_CHARTS = [
  'IMDb 电影 Top 250',
  'IMDb 剧集 Top 250',
  'Letterboxd 电影 Top 250',
  '豆瓣 电影 Top 250',
  'Metacritic 史上最佳电影 Top 250',
  'Metacritic 史上最佳剧集 Top 250',
];

// 支持手动录入的自定义数量榜单（显示指定行数表格，支持导出）
const MANUAL_ENTRY_CUSTOM_CHARTS: Record<string, number> = {
  'IMDb 工作人员2025最喜爱的电影': 27,
  'IMDb 工作人员2025最喜爱的剧集': 20,
  'Letterboxd 2025 Top 50': 50,
  'Letterboxd 电影 Top 250': 250,
  'Rotten Tomatoes 2025 最佳电影': 219,
  'Rotten Tomatoes 2025 最佳剧集': 121,
  'Metacritic 2025 最佳电影': 20,
  'Metacritic 2025 最佳剧集': 20,
};

// 平台名称反向映射（前端显示名称 → 后端存储名称）
const PLATFORM_NAME_REVERSE_MAP: Record<string, string> = {
  'Rotten Tomatoes': '烂番茄',
  'Metacritic': 'MTC',
};

// 榜单名称反向映射（前端显示名称 → 后端存储名称）
const CHART_NAME_REVERSE_MAP: Record<string, string> = {
  'IMDb 本周 Top 10': 'Top 10 on IMDb this week',
  '热门流媒体电影': 'Popular Streaming Movies',
  '热门剧集': 'Popular TV',
  '本周趋势电影': 'Trending Movies This Week',
  '本周趋势剧集': 'Trending Shows This Week',
  '本周热门影视': 'Popular films this week',
  '本周趋势影视': '趋势本周',
  '上周剧集 Top 榜': 'Top TV Shows Last Week',
  '上周电影 Top 榜': 'Top Movies Last Week',
  // IMDb 2025 榜单反向映射
  'IMDb 2025最受欢迎电影': 'IMDb 2025最受欢迎电影',
  'IMDb 2025最受欢迎剧集': 'IMDb 2025最受欢迎剧集',
  'IMDb 工作人员2025最喜爱的电影': 'IMDb 工作人员2025最喜爱的电影',
  'IMDb 工作人员2025最喜爱的剧集': 'IMDb 工作人员2025最喜爱的剧集',
  // Top 250 榜单反向映射
  'IMDb 电影 Top 250': 'IMDb Top 250 Movies',
  'IMDb 剧集 Top 250': 'IMDb Top 250 TV Shows',
  'Letterboxd 电影 Top 250': 'Letterboxd Official Top 250',
  '豆瓣 电影 Top 250': '豆瓣 Top 250',
  'Metacritic 史上最佳电影 Top 250': 'Metacritic Best Movies of All Time',
  'Metacritic 史上最佳剧集 Top 250': 'Metacritic Best TV Shows of All Time',
  'TMDB 高分电影 Top 250': 'TMDB Top 250 Movies',
  'TMDB 高分剧集 Top 250': 'TMDB Top 250 TV Shows',
};


export default function AdminChartsPage() {
  const { user, isLoading } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    document.title = '榜单录入（管理员） - RateFuse';
  }, []);
  const [currentList, setCurrentList] = useState<Array<{ tmdb_id:number; rank:number; title:string; poster:string; locked?: boolean }>>([]);
  const [currentListsByType, setCurrentListsByType] = useState<{ movie: Array<{ tmdb_id:number; rank:number; title:string; poster:string; locked?: boolean }>; tv: Array<{ tmdb_id:number; rank:number; title:string; poster:string; locked?: boolean }>}>({ movie: [], tv: [] });
  const [submitting, setSubmitting] = useState(false);
  const [activeKey, setActiveKey] = useState<string>('');
  
  // 自动更新相关状态
  const [autoUpdating, setAutoUpdating] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string>('');
  const [forceRefresh, setForceRefresh] = useState(0);
  const [schedulerState, setSchedulerState] = useState<{
    running: boolean;
    next_update: string | null;
    last_update: string | null;
  } | null>(null);
  
  // 各平台操作状态
  const [platformOperations, setPlatformOperations] = useState<Record<string, boolean>>({});
  
  // Telegram通知测试状态
  const [testingNotification, setTestingNotification] = useState(false);
  
  // 反爬虫验证状态
  const [antiScrapingState, setAntiScrapingState] = useState<{
    show: boolean;
    platform: string;
    chartName: string;
    verificationStarted: boolean;
  } | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerRank, setPickerRank] = useState<number | null>(null);
  const [pickerContext, setPickerContext] = useState<{ platform:string; chart_name:string; media_type:SectionType } | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerSelected, setPickerSelected] = useState<MediaItem | null>(null);
  const debouncedPickerQuery = useDebounce(pickerQuery, 350);

  const [modal, setModal] = useState<{
    open: boolean;
    title: string;
    message: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    variant?: 'default' | 'danger';
    onConfirm?: () => void;
  }>({ open: false, title: '', message: '' });

  const closeModal = () =>
    setModal((m) => ({
      ...m,
      open: false,
      onConfirm: undefined,
    }));

  const showAlert = (message: React.ReactNode, title = '提示') => {
    setModal({
      open: true,
      title,
      message,
      confirmText: '确定',
      cancelText: undefined,
      variant: 'default',
      onConfirm: closeModal,
    });
  };

  const showConfirm = (opts: {
    title: string;
    message: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    variant?: 'default' | 'danger';
    onConfirm: () => void;
  }) => {
    setModal({
      open: true,
      title: opts.title,
      message: opts.message,
      confirmText: opts.confirmText ?? '确定',
      cancelText: opts.cancelText ?? '取消',
      variant: opts.variant ?? 'default',
      onConfirm: () => {
        closeModal();
        opts.onConfirm();
      },
    });
  };

  const { data: pickerData } = useQuery({
    queryKey: ['tmdb-picker', debouncedPickerQuery],
    queryFn: () => adminSearchMedia(debouncedPickerQuery),
    enabled: pickerOpen && !!debouncedPickerQuery,
  });

  const { data: schedulerData, refetch: refetchScheduler, isLoading: schedulerLoading } = useQuery({
    queryKey: ['scheduler-status', forceRefresh],
    queryFn: async () => {
      try {
        const timestamp = new Date().getTime();
        const token = localStorage.getItem('token');
        const headers: HeadersInit = {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        const res = await fetch(`/api/scheduler/status?_t=${timestamp}`, {
          cache: 'no-store',
          headers,
          credentials: 'include',
        });
        
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        
        return res.json();
      } catch (error) {
        console.error('获取调度器状态失败:', error);
        return {
          status: 'error',
          data: {
            running: false,
            next_update: null,
            last_update: null
          }
        };
      }
    },
    refetchInterval: 10000,
    staleTime: 0,
    retry: 3,
    retryDelay: 1000
  });

  useEffect(() => {
    if (schedulerData && schedulerData.data) {
      setSchedulerState(schedulerData.data);
    }
  }, [schedulerData]);

  const getCurrentSchedulerState = () => {
    try {
      if (schedulerState) {
        return schedulerState;
      }
      
      if (schedulerData && schedulerData.data) {
        return schedulerData.data;
      }
      
      if (schedulerLoading) {
        return {
          running: false,
          next_update: null,
          last_update: null
        };
      }
      
      return null;
    } catch (error) {
      console.error('获取调度器状态时出错:', error);
      return null;
    }
  };

  useEffect(() => {
    if (!activeKey) return;
    const [platform, chart_name, media_type] = activeKey.split(':');
    loadCurrentList(platform, chart_name, media_type as SectionType);
  }, [activeKey, submitting]);

  const platforms = useMemo(
    () => CHART_STRUCTURE.map((item) => item.platform),
    [],
  );

  const [activePlatform, setActivePlatform] = useState<string>(
    CHART_STRUCTURE[0]?.platform ?? '',
  );

  const activePlatformConfig = CHART_STRUCTURE.find(
    ({ platform }) => platform === activePlatform,
  );

  if (isLoading) return <div className="p-4">加载中...</div>;
  if (!user?.is_admin) return <div className="p-4 text-red-500">无权限（仅管理员可访问）</div>;

  async function addEntry(platform: string, chart_name: string, media_type: 'movie' | 'tv', rank: number, item?: MediaItem) {
    if (!item) return;
    const choice = { id: item.id };
    
    const isMetacriticTop250 = chart_name === 'Metacritic 史上最佳电影 Top 250' || chart_name === 'Metacritic 史上最佳剧集 Top 250';
    let conflictExists = false;
    if (isMetacriticTop250) {
      conflictExists = currentListsByType.movie.some(i => i.rank === rank) || 
                      currentListsByType.tv.some(i => i.rank === rank);
    } else {
      conflictExists = (media_type === 'movie' ? currentListsByType.movie : currentListsByType.tv).some(i => i.rank === rank);
    }
    
    if (conflictExists) {
      showAlert(`该排名已存在条目，请先清空或选择其他排名。`);
      return;
    }
    
    setSubmitting(true);
    const backendPlatform = PLATFORM_NAME_REVERSE_MAP[platform] || platform;
    const backendChartName = CHART_NAME_REVERSE_MAP[chart_name] || chart_name;
    const payload = {
      platform: String(backendPlatform),
      chart_name: String(backendChartName),
      media_type: media_type === 'movie' ? 'movie' as const : 'tv' as const,
      tmdb_id: Number(choice.id),
      rank: Number(rank),
      title: item?.title || undefined,
      poster: item?.poster || undefined,
    };
    
    try {
      const response = await fetch('/api/charts/entries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
        },
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        const err = await response.json().catch(()=>({}));
        const detail = (err && (err.detail || err.message)) ? (err.detail || err.message) : '添加失败';
        showAlert(typeof detail === 'string' ? detail : JSON.stringify(detail));
        return;
      }
      
      if (activeKey) {
        const [currentPlatform, currentChartName, currentMediaType] = activeKey.split(':');
        if (isMetacriticTop250) {
          await loadCurrentList(currentPlatform, currentChartName, 'both' as SectionType);
        } else {
          await loadCurrentList(currentPlatform, currentChartName, currentMediaType as SectionType);
        }
      }
      
      const isTop250Chart = TOP_250_CHARTS.includes(chart_name);
      if (!isTop250Chart) {
        queryClient.invalidateQueries({ 
          queryKey: ['aggregate-charts'],
          refetchType: 'active'
        });
      }
      queryClient.invalidateQueries({ 
        queryKey: ['public-charts'],
        refetchType: 'active'
      });
      queryClient.invalidateQueries({ 
        queryKey: ['chart-detail'],
        refetchType: 'active'
      });
    } catch (error) {
      showAlert(`保存失败: ${error}`);
    } finally {
      setSubmitting(false);
      setPickerOpen(false);
      setPickerRank(null);
      setPickerContext(null);
      setPickerQuery('');
      setPickerSelected(null);
    }
  }

  function openPicker(platform:string, chart_name:string, media_type:SectionType, rank:number){
    setPickerOpen(true);
    setPickerRank(rank);
    const isMetacriticTop250 = (chart_name === 'Metacritic 史上最佳电影 Top 250' || chart_name === 'Metacritic 史上最佳剧集 Top 250') && MANUAL_ENTRY_CHARTS.includes(chart_name);
    const effectiveMediaType = isMetacriticTop250 ? 'both' : media_type;
    setPickerContext({ platform, chart_name, media_type: effectiveMediaType });
    setPickerQuery('');
    setPickerSelected(null);
  }

  async function handleAutoUpdateAll() {
    setAutoUpdating(true);
    setUpdateStatus('正在更新所有榜单...');
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/charts/auto-update', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      const result = await response.json();
      
      if (response.ok) {
        setUpdateStatus('所有榜单更新成功！');
        if (activeKey) {
          const [platform, chart_name, media_type] = activeKey.split(':');
          loadCurrentList(platform, chart_name, media_type as SectionType);
        }
      } else {
        setUpdateStatus(`更新失败: ${result.detail || '未知错误'}`);
      }
    } catch (error) {
      setUpdateStatus(`更新失败: ${error}`);
    } finally {
      setAutoUpdating(false);
      setTimeout(() => setUpdateStatus(''), 3000);
    }
  }

  async function handleAutoUpdatePlatform(platform: string) {
    const operationKey = `${platform}_update`;
    setPlatformOperations(prev => ({ ...prev, [operationKey]: true }));
    setUpdateStatus(`正在更新 ${platform} 榜单...`);
    
    try {
      const token = localStorage.getItem('token');
      const backendPlatform = PLATFORM_NAME_REVERSE_MAP[platform] || platform;
      const response = await fetch(`/api/charts/auto-update/${backendPlatform}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      const result = await response.json();
      
      if (response.ok) {
        setUpdateStatus(`${platform} 榜单更新成功！`);
        if (activeKey) {
          const [currentPlatform, chart_name, media_type] = activeKey.split(':');
          if (currentPlatform === platform) {
            loadCurrentList(currentPlatform, chart_name, media_type as SectionType);
          }
        }
      } else {
        setUpdateStatus(`更新失败: ${result.detail || '未知错误'}`);
      }
    } catch (error) {
      setUpdateStatus(`更新失败: ${error}`);
    } finally {
      setPlatformOperations(prev => ({ ...prev, [operationKey]: false }));
      setTimeout(() => setUpdateStatus(''), 3000);
    }
  }

  async function handleUpdateTop250Chart(platform: string, chartName: string) {
    const operationKey = `${platform}_${chartName}_update`;
    setPlatformOperations(prev => ({ ...prev, [operationKey]: true }));
    setUpdateStatus(`正在更新 ${chartName}...`);
    
    try {
      const token = localStorage.getItem('token');
      const backendPlatform = PLATFORM_NAME_REVERSE_MAP[platform] || platform;
      const backendChartName = CHART_NAME_REVERSE_MAP[chartName] || chartName;
      
      const response = await fetch(`/api/charts/update-top250`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          platform: backendPlatform,
          chart_name: backendChartName,
        }),
      });
      
      const result = await response.json();
      
      if (response.ok) {
        setUpdateStatus(`${chartName} 更新成功！`);
        setAntiScrapingState(null);
        if (activeKey) {
          const [currentPlatform, currentChartName, media_type] = activeKey.split(':');
          if (currentPlatform === platform && currentChartName === chartName) {
            loadCurrentList(currentPlatform, currentChartName, media_type as SectionType);
          }
        }
      } else if (response.status === 428 && result.detail?.error === 'ANTI_SCRAPING_DETECTED') {
        setAntiScrapingState({
          show: true,
          platform: platform,
          chartName: chartName,
          verificationStarted: false,
        });
        setUpdateStatus('遇到反爬虫机制，请验证');
      } else {
        setUpdateStatus(`更新失败: ${result.detail?.message || result.detail || '未知错误'}`);
      }
    } catch (error) {
      setUpdateStatus(`更新失败: ${error}`);
    } finally {
      if (!antiScrapingState || !antiScrapingState.show) {
        setPlatformOperations(prev => ({ ...prev, [operationKey]: false }));
        setTimeout(() => {
          if (!antiScrapingState || !antiScrapingState.show) {
            setUpdateStatus('');
          }
        }, 3000);
      }
    }
  }
  
  function handleStartVerification() {
    if (antiScrapingState) {
      window.open('https://movie.douban.com/', '_blank');
      setAntiScrapingState(prev => prev ? { ...prev, verificationStarted: true } : null);
    }
  }
  
  async function handleCompleteVerification() {
    if (antiScrapingState) {
      await handleUpdateTop250Chart(antiScrapingState.platform, antiScrapingState.chartName);
      setAntiScrapingState(null);
    }
  }

  async function handleClearTop250Chart(platform: string, chartName: string) {
    showConfirm({
      title: '清空榜单',
      message: `确定要清空 ${chartName} 吗？此操作不可撤销。`,
      confirmText: '清空',
      variant: 'danger',
      onConfirm: () => {
        void (async () => {
          const operationKey = `${platform}_${chartName}_clear`;
          setPlatformOperations(prev => ({ ...prev, [operationKey]: true }));
          setUpdateStatus(`正在清空 ${chartName}...`);
          
          try {
            const token = localStorage.getItem('token');
            const backendPlatform = PLATFORM_NAME_REVERSE_MAP[platform] || platform;
            const backendChartName = CHART_NAME_REVERSE_MAP[chartName] || chartName;
            
            const response = await fetch(`/api/charts/clear-top250`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                platform: backendPlatform,
                chart_name: backendChartName,
              }),
            });
            
            const result = await response.json();
            
            if (response.ok) {
              setUpdateStatus(`${chartName} 已清空！`);
              if (activeKey) {
                const [currentPlatform, currentChartName, media_type] = activeKey.split(':');
                if (currentPlatform === platform && currentChartName === chartName) {
                  loadCurrentList(currentPlatform, currentChartName, media_type as SectionType);
                }
              }
            } else {
              setUpdateStatus(`清空失败: ${result.detail || '未知错误'}`);
            }
          } catch (error) {
            setUpdateStatus(`清空失败: ${error}`);
          } finally {
            setPlatformOperations(prev => ({ ...prev, [operationKey]: false }));
            setTimeout(() => setUpdateStatus(''), 3000);
          }
        })();
      },
    });
  }

  async function handleClearPlatform(platform: string) {
    showConfirm({
      title: '清空平台榜单',
      message: `确定要清空 ${platform} 平台的所有榜单吗？此操作不可撤销。`,
      confirmText: '清空',
      variant: 'danger',
      onConfirm: () => {
        void (async () => {
          const operationKey = `${platform}_clear`;
          setPlatformOperations(prev => ({ ...prev, [operationKey]: true }));
          setUpdateStatus(`正在清空 ${platform} 榜单...`);
          
          try {
            const token = localStorage.getItem('token');
            const backendPlatform = PLATFORM_NAME_REVERSE_MAP[platform] || platform;
            const response = await fetch(`/api/charts/clear/${backendPlatform}`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            });
            
            const result = await response.json();
            
            if (response.ok) {
              setUpdateStatus(`${platform} 榜单已清空！`);
              if (activeKey) {
                const [currentPlatform, chart_name, media_type] = activeKey.split(':');
                if (currentPlatform === platform) {
                  loadCurrentList(currentPlatform, chart_name, media_type as SectionType);
                }
              }
            } else {
              setUpdateStatus(`清空失败: ${result.detail || '未知错误'}`);
            }
          } catch (error) {
            setUpdateStatus(`清空失败: ${error}`);
          } finally {
            setPlatformOperations(prev => ({ ...prev, [operationKey]: false }));
            setTimeout(() => setUpdateStatus(''), 3000);
          }
        })();
      },
    });
  }

  async function handleClearAllPlatforms() {
    showConfirm({
      title: '清空所有榜单',
      message: '确定要清空所有平台的所有榜单吗？此操作不可撤销。',
      confirmText: '清空',
      variant: 'danger',
      onConfirm: () => {
        void (async () => {
          const operationKey = 'clear_all';
          setPlatformOperations(prev => ({ ...prev, [operationKey]: true }));
          setUpdateStatus('正在清空所有榜单...');
          
          try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/charts/clear-all', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            });
            
            const result = await response.json();
            
            if (response.ok) {
              setUpdateStatus('所有榜单已清空！');
              if (activeKey) {
                const [currentPlatform, chart_name, media_type] = activeKey.split(':');
                loadCurrentList(currentPlatform, chart_name, media_type as SectionType);
              }
            } else {
              setUpdateStatus(`清空失败: ${result.detail || '未知错误'}`);
            }
          } catch (error) {
            setUpdateStatus(`清空失败: ${error}`);
          } finally {
            setPlatformOperations(prev => ({ ...prev, [operationKey]: false }));
            setTimeout(() => setUpdateStatus(''), 3000);
          }
        })();
      },
    });
  }

  async function loadCurrentList(platform: string, chart_name: string, media_type: SectionType) {
    try {
      const token = localStorage.getItem('token');
      const authHeaders = { 'Authorization': `Bearer ${token}` };
      
      const backendPlatform = PLATFORM_NAME_REVERSE_MAP[platform] || platform;
      const backendChartName = CHART_NAME_REVERSE_MAP[chart_name] || chart_name;
      
      const isMetacriticTop250 = chart_name === 'Metacritic 史上最佳电影 Top 250' || chart_name === 'Metacritic 史上最佳剧集 Top 250';
      const shouldLoadBoth = media_type === 'both' || isMetacriticTop250;
      
      if (shouldLoadBoth) {
        const [movieResponse, tvResponse] = await Promise.all([
          fetch(`/api/charts/entries?platform=${encodeURIComponent(backendPlatform)}&chart_name=${encodeURIComponent(backendChartName)}&media_type=movie`, { headers: authHeaders }),
          fetch(`/api/charts/entries?platform=${encodeURIComponent(backendPlatform)}&chart_name=${encodeURIComponent(backendChartName)}&media_type=tv`, { headers: authHeaders })
        ]);
        
        const movies = movieResponse.ok ? await movieResponse.json() : [];
        const tvs = tvResponse.ok ? await tvResponse.json() : [];
        
        const byRank: Record<number, any> = {};
        [...movies, ...tvs].forEach((i: any) => {
          if (!byRank[i.rank] || byRank[i.rank].id < i.id) {
            byRank[i.rank] = i;
          }
        });
        const merged = Array.from({ length: 250 }, (_, idx) => byRank[idx+1]).filter(Boolean).map((i: any) => ({ 
          tmdb_id: i.tmdb_id, 
          rank: i.rank, 
          title: i.title, 
          poster: i.poster, 
          locked: i.locked 
        }));
        
        setCurrentList(merged);
        setCurrentListsByType({
          movie: movies.map((i: any) => ({ tmdb_id: i.tmdb_id, rank: i.rank, title: i.title, poster: i.poster, locked: i.locked })),
          tv: tvs.map((i: any) => ({ tmdb_id: i.tmdb_id, rank: i.rank, title: i.title, poster: i.poster, locked: i.locked })),
        });
      } else {
        const response = await fetch(`/api/charts/entries?platform=${encodeURIComponent(backendPlatform)}&chart_name=${encodeURIComponent(backendChartName)}&media_type=${media_type}`, {
          headers: authHeaders,
        });
        
        if (response.ok) {
          const data = await response.json();
          setCurrentList(data.map((i: any) => ({ 
            tmdb_id: i.tmdb_id, 
            rank: i.rank, 
            title: i.title, 
            poster: i.poster, 
            locked: i.locked 
          })));
          
          setCurrentListsByType(prev => ({
            movie: media_type === 'movie' ? data.map((i: any) => ({ tmdb_id: i.tmdb_id, rank: i.rank, title: i.title, poster: i.poster, locked: i.locked })) : prev.movie,
            tv: media_type === 'tv' ? data.map((i: any) => ({ tmdb_id: i.tmdb_id, rank: i.rank, title: i.title, poster: i.poster, locked: i.locked })) : prev.tv,
          }));
        }
      }
    } catch (error) {
      console.error('加载榜单数据失败:', error);
    }
  }

  async function handleSyncCharts() {
    try {
      const response = await fetch('/api/charts/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || '同步失败');
      }

      const data = await response.json();
      showAlert(data.message || '同步成功！');
      
      queryClient.invalidateQueries({ 
        queryKey: ['public-charts'],
        refetchType: 'active'
      });
      queryClient.invalidateQueries({ 
        queryKey: ['chart-detail'],
        refetchType: 'active'
      });
      queryClient.invalidateQueries({ 
        queryKey: ['aggregate-charts'],
        refetchType: 'active'
      });
    } catch (error) {
      console.error('同步榜单失败:', error);
      showAlert(error instanceof Error ? error.message : '同步失败');
    }
  }

  async function handleTestNotification() {
    setTestingNotification(true);
    setUpdateStatus('正在测试Telegram通知...');
    
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      const response = await fetch('/api/scheduler/test-notification', {
        method: 'POST',
        headers,
        credentials: 'include',
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setUpdateStatus('✅ 测试通知发送成功！');
        setTimeout(() => setUpdateStatus(''), 5000);
      } else {
        setUpdateStatus(`❌ 测试通知失败: ${data.message || '未知错误'}`);
        setTimeout(() => setUpdateStatus(''), 5000);
      }
    } catch (error) {
      console.error('测试通知失败:', error);
      setUpdateStatus('❌ 测试通知失败: 网络错误');
      setTimeout(() => setUpdateStatus(''), 5000);
    } finally {
      setTestingNotification(false);
    }
  }

  async function handleStartScheduler() {
    try {
      console.log('开始启动调度器...');
      const token = localStorage.getItem('token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      setSchedulerState(prev => prev ? { ...prev, running: true } : null);
      
      console.log('发送启动请求到 /api/scheduler/start');
      const response = await fetch('/api/scheduler/start', {
        method: 'POST',
        headers,
        credentials: 'include',
      });
      
      console.log('响应状态:', response.status);
      
      if (!response.ok) {
        setSchedulerState(prev => prev ? { ...prev, running: false } : null);
        const errorText = await response.text();
        console.error('启动失败响应:', errorText);
        setUpdateStatus(`启动调度器失败 (${response.status}): ${errorText}`);
        setTimeout(() => setUpdateStatus(''), 5000);
        return;
      }
      
      const result = await response.json();
      console.log('启动成功响应:', result);
      
      setForceRefresh(prev => prev + 1);
      await refetchScheduler();
      
      setUpdateStatus('定时任务调度器已启动');
      setTimeout(() => setUpdateStatus(''), 3000);
    } catch (error) {
      setSchedulerState(prev => prev ? { ...prev, running: false } : null);
      console.error('启动调度器异常:', error);
      setUpdateStatus(`启动调度器失败: ${error}`);
      setTimeout(() => setUpdateStatus(''), 5000);
    }
  }

  async function handleStopScheduler() {
    try {
      console.log('开始停止调度器...');
      const token = localStorage.getItem('token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      setSchedulerState(prev => prev ? { ...prev, running: false } : null);
      
      const response = await fetch('/api/scheduler/stop', {
        method: 'POST',
        headers,
        credentials: 'include',
      });
      
      if (!response.ok) {
        setSchedulerState(prev => prev ? { ...prev, running: true } : null);
        const errorText = await response.text();
        setUpdateStatus(`停止调度器失败 (${response.status}): ${errorText}`);
        setTimeout(() => setUpdateStatus(''), 5000);
        return;
      }
      
      const result = await response.json();
      console.log('停止成功响应:', result);
      
      setForceRefresh(prev => prev + 1);
      await refetchScheduler();
      
      setUpdateStatus('定时任务调度器已停止');
      setTimeout(() => setUpdateStatus(''), 3000);
    } catch (error) {
      setSchedulerState(prev => prev ? { ...prev, running: true } : null);
      console.error('停止调度器异常:', error);
      setUpdateStatus(`停止调度器失败: ${error}`);
      setTimeout(() => setUpdateStatus(''), 5000);
    }
  }


  return (
    <div className={`min-h-screen bg-[var(--page-bg)]`}>
      <ConfirmDialog
        open={modal.open}
        title={modal.title}
        message={modal.message}
        confirmText={modal.confirmText}
        cancelText={modal.cancelText}
        variant={modal.variant}
        onCancel={closeModal}
        onConfirm={() => (modal.onConfirm ? modal.onConfirm() : closeModal())}
      />
      {/* 反爬虫验证提示 */}
      {antiScrapingState && antiScrapingState.show && (
        <div className="modal-root fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className={`modal-card w-full max-w-md rounded-lg p-6 glass-card`}>
            <div className="flex items-center justify-between mb-4">
              <div className={`text-lg font-semibold text-gray-800 dark:text-white`}>
                遇到反爬虫机制，请验证
              </div>
            </div>
            <div className={`mb-4 text-gray-700 dark:text-gray-300`}>
              <p>抓取 {antiScrapingState.chartName} 时遇到反爬虫机制。</p>
              <p className="mt-2">请点击"验证"按钮，在新标签页中完成验证后，点击"验证完成"继续抓取。</p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setAntiScrapingState(null);
                  const operationKey = `${antiScrapingState.platform}_${antiScrapingState.chartName}_update`;
                  setPlatformOperations(prev => ({ ...prev, [operationKey]: false }));
                  setUpdateStatus('');
                }}
                className={`px-4 py-2 rounded transition-colors bg-gray-700 text-gray-200 hover:bg-gray-600`}
              >
                取消
              </button>
              {!antiScrapingState.verificationStarted ? (
                <button
                  onClick={handleStartVerification}
                  className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                  验证
                </button>
              ) : (
                <button
                  onClick={handleCompleteVerification}
                  className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 transition-colors"
                >
                  验证完成
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <ThemeToggle />
      <div className={`container mx-auto px-4 py-6 transition-colors`}>
        <div className="flex justify-between items-center mb-4">
          <h1 className={`text-2xl font-bold text-gray-800 dark:text-white`}>
            榜单录入（管理员）
          </h1>
        
          {/* 自动更新控制面板 */}
          <div className="flex items-center gap-4">
          
          {/* 状态显示 */}
          {updateStatus && (
            <div className={`px-3 py-1 rounded text-sm bg-blue-900 text-blue-200`}>
              {updateStatus}
            </div>
          )}
          
            {/* 调度器状态 */}
            {getCurrentSchedulerState() && (
              <div className="flex items-center gap-2 text-sm">
                <div className={`w-2 h-2 rounded-full ${
                  getCurrentSchedulerState()?.running ? 'bg-green-500' : 'bg-gray-400'
                }`}></div>
                <span className={'text-gray-700 dark:text-gray-300'}>
                  {getCurrentSchedulerState()?.running ? '调度器运行中' : '调度器已停止'}
                </span>
                {getCurrentSchedulerState()?.last_update && (
                  <span className={`text-xs text-gray-600 dark:text-gray-400`}>
                    上次更新: {formatChinaDateTime(getCurrentSchedulerState()?.last_update)}
                  </span>
                )}
              </div>
            )}
            
            {/* 全部更新和清空按钮 */}
            <div className="flex gap-3 py-3 px-1">
              <button
                onClick={handleClearAllPlatforms}
                disabled={platformOperations['clear_all']}
                className={`px-4 py-2 rounded font-medium transition-colors ${platformOperations['clear_all'] ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-700'}`}
              >
                {platformOperations['clear_all'] ? '处理中...' : '清空'}
              </button>
              <button
                onClick={handleAutoUpdateAll}
                disabled={autoUpdating}
                className={`px-4 py-2 rounded font-medium transition-colors ${autoUpdating ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
              >
                {autoUpdating ? '更新中...' : '更新'}
              </button>
              <button
                onClick={handleSyncCharts}
                className="px-4 py-2 rounded font-medium transition-colors bg-green-600 text-white hover:bg-green-700"
              >
                同步
              </button>
            </div>
          </div>
        </div>

      {/* 调度器控制面板 */}
      {getCurrentSchedulerState() && (
        <div className={`mb-6 p-4 rounded-lg glass-card`}>
          <h3 className={`text-lg font-semibold mb-3 text-gray-800 dark:text-white`}>
            定时自动更新
          </h3>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${
                getCurrentSchedulerState()?.running ? 'bg-green-500' : 'bg-gray-400'
              }`}></div>
              <span className={`font-medium text-gray-800 dark:text-white`}>
                {getCurrentSchedulerState()?.running ? '运行中' : '已停止'}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <span className={`text-sm text-gray-700 dark:text-gray-300`}>
                更新时间: 每天 21:30 (北京时间)
              </span>
              {getCurrentSchedulerState()?.next_update && (
                <span className={`text-xs text-gray-600 dark:text-gray-400`}>
                  下次更新: {formatChinaDateTime(getCurrentSchedulerState()?.next_update)}
                </span>
              )}
            </div>
            
            <div className="flex gap-2 py-3 px-1">
              {getCurrentSchedulerState()?.running ? (
                <button
                  onClick={handleStopScheduler}
                  className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                >
                  停止定时
                </button>
              ) : (
                <button
                  onClick={handleStartScheduler}
                  className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                >
                  启动定时
                </button>
              )}
              
              <button
                onClick={handleTestNotification}
                disabled={testingNotification}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  testingNotification 
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {testingNotification ? '测试中...' : '测试通知'}
              </button>
            </div>
            
            {getCurrentSchedulerState()?.last_update && (
              <div className={`text-sm text-gray-600 dark:text-gray-400`}>
                上次更新: {formatChinaDateTime(getCurrentSchedulerState()?.last_update)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 平台卡片式标签 */}

      <div className="glass-card overflow-visible rounded-2xl p-4 space-y-4">
        <CardTabs
          tabs={platforms.map((platform) => ({
            id: platform,
            label: (
              <div className="flex items-center gap-2">
                {PLATFORM_LOGOS[platform] && (
                  <img
                    src={PLATFORM_LOGOS[platform]}
                    alt={platform}
                    className="w-10 h-10 sm:w-5 h-5 object-contain flex-shrink-0"
                  />
                )}
                <span className="hidden sm:inline">{platform}</span>
              </div>
            ),
          }))}
          activeId={activePlatform}
          onChange={setActivePlatform}
        />

        {(() => {
          if (!activePlatformConfig) return null;
          const platform = activePlatformConfig.platform;

          return (
            <div key={platform}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {PLATFORM_LOGOS[platform] && (
                    <img
                      src={PLATFORM_LOGOS[platform]}
                      alt={platform}
                      className="w-6 h-6 object-contain"
                    />
                  )}
                  <h2 className={`text-xl font-bold text-gray-800 dark:text-white`}>
                    {platform}
                  </h2>
                </div>
                <div className="flex gap-2 py-3 px-1">
                  <button
                    onClick={() => handleClearPlatform(platform)}
                    disabled={platformOperations[`${platform}_clear`]}
                    className={`text-sm px-3 py-1 rounded transition-colors ${platformOperations[`${platform}_clear`] ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-red-500 text-white hover:bg-red-600'}`}
                  >
                    {platformOperations[`${platform}_clear`] ? '处理中...' : `清空`}
                  </button>
                  <button
                    onClick={() => handleAutoUpdatePlatform(platform)}
                    disabled={platformOperations[`${platform}_update`]}
                    className={`text-sm px-3 py-1 rounded transition-colors ${platformOperations[`${platform}_update`] ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
                  >
                    {platformOperations[`${platform}_update`] ? '更新中...' : `更新`}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {activePlatformConfig.sections.map((sec) => {
                  const isMetacriticTop250 =
                    (sec.name === 'Metacritic 史上最佳电影 Top 250' ||
                      sec.name === 'Metacritic 史上最佳剧集 Top 250') &&
                    MANUAL_ENTRY_CHARTS.includes(sec.name);
                  const effectiveMediaType = isMetacriticTop250 ? 'both' : sec.media_type;
                  const key = `${platform}:${sec.name}:${effectiveMediaType}`;
                  return (
                    <div key={key} className={`border rounded p-3 glass-card overflow-visible`}>
                      {/* 以下内容保持原有结构不变 */}
                      <div className="flex items-center justify-between mb-2">
                        <div className={`font-medium text-gray-800 dark:text-white`}>
                          {sec.name}
                        </div>
                        <div className="flex gap-2 py-3 px-1">
                          {TOP_250_CHARTS.includes(sec.name) && (
                            <>
                              {!MANUAL_ONLY_CHARTS.includes(sec.name) && (
                                <button
                                  onClick={() => handleUpdateTop250Chart(platform, sec.name)}
                                  disabled={platformOperations[`${platform}_${sec.name}_update`]}
                                  className={`text-sm px-3 py-1 rounded transition-colors ${
                                    platformOperations[`${platform}_${sec.name}_update`]
                                      ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                      : 'bg-orange-500 text-white hover:bg-orange-600'
                                  }`}
                                >
                                  {platformOperations[`${platform}_${sec.name}_update`]
                                    ? '更新中...'
                                    : '更新 Top 250'}
                                </button>
                              )}
                              {(MANUAL_ENTRY_CHARTS.includes(sec.name) ||
                                MANUAL_ENTRY_CUSTOM_CHARTS[sec.name]) && (
                                <button
                                  onClick={() => {
                                    if (activeKey !== key) {
                                      setActiveKey(key);
                                    }
                                  }}
                                  className={`text-sm px-3 py-1 rounded transition-colors bg-blue-500 text-white hover:bg-blue-600`}
                                >
                                  手动录入
                                </button>
                              )}
                              <button
                                onClick={() => handleClearTop250Chart(platform, sec.name)}
                                disabled={platformOperations[`${platform}_${sec.name}_clear`]}
                                className={`text-sm px-3 py-1 rounded transition-colors ${
                                  platformOperations[`${platform}_${sec.name}_clear`]
                                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                    : 'bg-red-500 text-white hover:bg-red-600'
                                }`}
                              >
                                {platformOperations[`${platform}_${sec.name}_clear`]
                                  ? '清空中...'
                                  : '清空 Top 250'}
                              </button>
                            </>
                          )}
                          <button
                            className={`text-sm text-purple-400 hover:text-purple-300`}
                            onClick={() => setActiveKey(key)}
                          >
                            选择
                          </button>
                          <button
                            className={`text-sm text-green-400 hover:text-green-300`}
                            onClick={() => {
                              if (activeKey === key) {
                                setActiveKey('');
                              } else {
                                setActiveKey(key);
                              }
                            }}
                          >
                            {activeKey === key ? '收起' : '展开'}
                          </button>
                        </div>
                      </div>
                      {activeKey === key && (
                        <div className="space-y-3">
                          {(MANUAL_ONLY_CHARTS.includes(sec.name) ||
                            MANUAL_ENTRY_CHARTS.includes(sec.name) ||
                            MANUAL_ENTRY_CUSTOM_CHARTS[sec.name]) ? (
                            <div className="overflow-x-auto max-h-[70vh] overflow-y-auto scrollbar-gentle">
                              {/* 表格结构保持不变 */}
                              <table className="w-full border-collapse">
                                <thead className={`sticky top-0 bg-gray-100 dark:bg-gray-900 z-10`}>
                                  <tr className={`border-b border-gray-300 dark:border-gray-600`}>
                                    <th className={`text-left py-2 px-3 text-sm font-medium text-gray-900 dark:text-white w-16`}>排名</th>
                                    <th className={`text-left py-2 px-3 text-sm font-medium text-gray-900 dark:text-white w-20`}>海报</th>
                                    <th className={`text-left py-2 px-3 text-sm font-medium text-gray-900 dark:text-white`}>标题</th>
                                    <th className={`text-left py-2 px-3 text-sm font-medium text-gray-900 dark:text-white w-32`}>操作</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {Array.from(
                                    { length: MANUAL_ENTRY_CUSTOM_CHARTS[sec.name] || 250 },
                                    (_, idx) => idx + 1,
                                  ).map((r) => {
                                    const current = currentList.find((i) => i.rank === r);
                                    const isMetacriticTop250Row =
                                      sec.name === 'Metacritic 史上最佳电影 Top 250' ||
                                      sec.name === 'Metacritic 史上最佳剧集 Top 250';
                                    const locked = isMetacriticTop250Row
                                      ? currentListsByType.movie.some(
                                          (i) => i.rank === r && i.locked,
                                        ) ||
                                        currentListsByType.tv.some(
                                          (i) => i.rank === r && i.locked,
                                        )
                                      : (sec.media_type === 'movie'
                                          ? currentListsByType.movie
                                          : sec.media_type === 'tv'
                                            ? currentListsByType.tv
                                            : currentList
                                        ).some((i) => i.rank === r && i.locked);
                                    const displayRank =
                                      sec.name === '豆瓣2025评分月度热搜影视' && r >= 1 && r <= 12
                                        ? `${r}月`
                                        : r;
                                    return (
                                      <tr
                                        key={r}
                                        className={`border-b border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800/30 ${
                                          current ? '' : 'opacity-60'
                                        }`}
                                      >
                                        <td className={`py-2 px-3 text-sm text-gray-900 dark:text-white font-medium text-center`}>
                                          {displayRank}
                                        </td>
                                        <td className={`py-2 px-3`}>
                                          <div className={`w-12 h-18 overflow-hidden rounded bg-gray-700`}>
                                            {current?.poster ? (
                                              <img
                                                src={posterPathToSiteUrl(current.poster, 'w185')}
                                                alt="thumb"
                                                className="w-full h-full object-cover"
                                              />
                                            ) : (
                                              <div className={`w-full h-full flex items-center justify-center text-[10px] text-gray-500`}>
                                                无
                                              </div>
                                            )}
                                          </div>
                                        </td>
                                        <td className={`py-2 px-3 text-sm text-gray-900 dark:text-white`}>
                                          {current?.title || (
                                            <span className="text-gray-500 dark:text-gray-400">-</span>
                                          )}
                                        </td>
                                        <td className={`py-2 px-3`}>
                                          <div className="flex gap-1 items-center whitespace-nowrap">
                                            <button
                                              disabled={locked}
                                              onClick={() =>
                                                openPicker(platform, sec.name, sec.media_type, r)
                                              }
                                              className={`px-2 py-1 rounded text-xs transition-colors ${
                                                locked
                                                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                                  : 'bg-green-600 text-white hover:bg-green-700'
                                              }`}
                                            >
                                              {current ? '修改' : '选择'}
                                            </button>
                                            {current && (
                                              <button
                                                onClick={async () => {
                                                  const effectiveType =
                                                    sec.media_type === 'both'
                                                      ? currentListsByType.movie.find((i) => i.rank === r)
                                                        ? 'movie'
                                                        : 'tv'
                                                      : sec.media_type;
                                                  const backendPlatform = PLATFORM_NAME_REVERSE_MAP[platform] || platform;
                                                  const backendChartName = CHART_NAME_REVERSE_MAP[sec.name] || sec.name;
                                                  await fetch(
                                                    `/api/charts/entries/lock?platform=${encodeURIComponent(
                                                      backendPlatform,
                                                    )}&chart_name=${encodeURIComponent(
                                                      backendChartName,
                                                    )}&media_type=${encodeURIComponent(
                                                      effectiveType,
                                                    )}&rank=${r}&locked=${!locked}`,
                                                    {
                                                      method: 'PUT',
                                                      headers: {
                                                        Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
                                                      },
                                                    },
                                                  );
                                                  setSubmitting((s) => !s);
                                                }}
                                                className={`px-2 py-1 rounded text-xs transition-colors ${
                                                  locked
                                                    ? 'bg-red-500 text-white hover:bg-red-600'
                                                    : 'bg-blue-500 text-white hover:bg-blue-600'
                                                }`}
                                              >
                                                {locked ? '解锁' : '锁定'}
                                              </button>
                                            )}
                                            {current && !locked && (
                                              <button
                                                onClick={async () => {
                                                  const effectiveType =
                                                    sec.media_type === 'both'
                                                      ? currentListsByType.movie.find((i) => i.rank === r)
                                                        ? 'movie'
                                                        : 'tv'
                                                      : sec.media_type;
                                                  const backendPlatform = PLATFORM_NAME_REVERSE_MAP[platform] || platform;
                                                  const backendChartName = CHART_NAME_REVERSE_MAP[sec.name] || sec.name;
                                                  await fetch(
                                                    `/api/charts/entries?platform=${encodeURIComponent(
                                                      backendPlatform,
                                                    )}&chart_name=${encodeURIComponent(
                                                      backendChartName,
                                                    )}&media_type=${encodeURIComponent(
                                                      effectiveType,
                                                    )}&rank=${r}`,
                                                    {
                                                      method: 'DELETE',
                                                      headers: {
                                                        Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
                                                      },
                                                    },
                                                  );
                                                  setSubmitting((s) => !s);
                                                }}
                                                className="px-2 py-1 rounded text-xs transition-colors bg-gray-600 text-gray-200 hover:bg-gray-500"
                                              >
                                                清空
                                              </button>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 items-end">
                              {Array.from(
                                { length: sec.name === '豆瓣2025评分月度热搜影视' ? 12 : 10 },
                                (_, idx) => idx + 1,
                              ).map((r) => {
                                const current = currentList.find((i) => i.rank === r);
                                const locked = (
                                  sec.media_type === 'movie'
                                    ? currentListsByType.movie
                                    : sec.media_type === 'tv'
                                      ? currentListsByType.tv
                                      : currentList
                                ).some((i) => i.rank === r && i.locked);
                                const displayRank =
                                  sec.name === '豆瓣2025评分月度热搜影视' && r >= 1 && r <= 12
                                    ? `${r}月`
                                    : r;
                                return (
                                  <div key={r} className="flex flex-col items-center">
                                    <div className={`w-12 h-18 overflow-hidden rounded mb-1 bg-gray-700`}>
                                      {current?.poster ? (
                                        <img
                                          src={posterPathToSiteUrl(current.poster, 'w185')}
                                          alt="thumb"
                                          className="w-full h-full object-cover"
                                        />
                                      ) : (
                                        <div className={`w-full h-full flex items-center justify-center text-[10px] text-gray-500`}>
                                          无
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex gap-1 flex-nowrap justify-center">
                                      <button
                                        disabled={locked}
                                        onClick={() => openPicker(platform, sec.name, sec.media_type, r)}
                                        className={`shrink-0 min-w-[2.75rem] sm:min-w-[3.25rem] px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-xs sm:text-sm transition-colors ${
                                          locked
                                            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                            : 'bg-green-600 text-white hover:bg-green-700'
                                        }`}
                                      >
                                        排名{displayRank}
                                      </button>
                                      {current && (
                                        <button
                                          onClick={async () => {
                                            const effectiveType =
                                              sec.media_type === 'both'
                                                ? current?.title
                                                  ? currentListsByType.movie.find((i) => i.rank === r)
                                                    ? 'movie'
                                                    : 'tv'
                                                  : 'movie'
                                                : sec.media_type;
                                            const backendPlatform =
                                              PLATFORM_NAME_REVERSE_MAP[platform] || platform;
                                            const backendChartName =
                                              CHART_NAME_REVERSE_MAP[sec.name] || sec.name;
                                            await fetch(
                                              `/api/charts/entries/lock?platform=${encodeURIComponent(
                                                backendPlatform,
                                              )}&chart_name=${encodeURIComponent(
                                                backendChartName,
                                              )}&media_type=${encodeURIComponent(
                                                effectiveType,
                                              )}&rank=${r}&locked=${!locked}`,
                                              {
                                                method: 'PUT',
                                                headers: {
                                                  Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
                                                },
                                              },
                                            );
                                            setSubmitting((s) => !s);
                                          }}
                                          className={`shrink-0 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-xs sm:text-sm transition-colors whitespace-nowrap ${
                                            locked
                                              ? 'bg-red-500 text-white hover:bg-red-600'
                                              : 'bg-blue-500 text-white hover:bg-blue-600'
                                          }`}
                                        >
                                          {locked ? '解锁' : '锁定'}
                                        </button>
                                      )}
                                      {current && !locked && (
                                        <button
                                          onClick={async () => {
                                            const effectiveType =
                                              sec.media_type === 'both'
                                                ? currentListsByType.movie.find((i) => i.rank === r)
                                                  ? 'movie'
                                                  : 'tv'
                                                : sec.media_type;
                                            const backendPlatform =
                                              PLATFORM_NAME_REVERSE_MAP[platform] || platform;
                                            const backendChartName =
                                              CHART_NAME_REVERSE_MAP[sec.name] || sec.name;
                                            await fetch(
                                              `/api/charts/entries?platform=${encodeURIComponent(
                                                backendPlatform,
                                              )}&chart_name=${encodeURIComponent(
                                                backendChartName,
                                              )}&media_type=${encodeURIComponent(
                                                effectiveType,
                                              )}&rank=${r}`,
                                              {
                                                method: 'DELETE',
                                                headers: {
                                                  Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
                                                },
                                              },
                                            );
                                            setSubmitting((s) => !s);
                                          }}
                                          className={`shrink-0 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-xs sm:text-sm transition-colors whitespace-nowrap bg-gray-600 text-gray-200 hover:bg-gray-500`}
                                        >
                                          清空
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                      <div className={`text-xs mt-2 text-gray-600 dark:text-gray-400`}>
                        {(MANUAL_ONLY_CHARTS.includes(sec.name) ||
                          MANUAL_ENTRY_CHARTS.includes(sec.name) ||
                          MANUAL_ENTRY_CUSTOM_CHARTS[sec.name])
                          ? '提示：点击\"选择\"按钮后搜索选择影视作品，排名由表格行号决定。'
                          : '提示：点击排名按钮后进行搜索选择并完成。'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>

      {/* 选择器弹层 */}
      {pickerOpen && (
        <div className="modal-root fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className={`modal-card w-full max-w-3xl rounded-lg p-4 glass-card overflow-visible`}>
            <div className="flex items-center justify-between mb-3">
              <div className={`text-lg font-semibold text-gray-800 dark:text-white`}>
                {pickerContext?.chart_name} - 选择排名{pickerRank}
              </div>
              <button 
                onClick={()=>setPickerOpen(false)} 
                className={`text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300`}
              >
                关闭
              </button>
            </div>
            <div className="flex gap-2">
              <input 
                value={pickerQuery} 
                onChange={e=>setPickerQuery(e.target.value)} 
                placeholder="搜索影视（支持多语言、名称+年份、IMDB ID、TMDB ID）" 
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-3 py-2 glass-dropdown text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400" 
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-4 max-h-[50vh] overflow-auto scrollbar-gentle py-2 px-1">
              {[...(pickerData?.movies.results||[]), ...(pickerData?.tvShows.results||[])].filter(i=>{
                if (!pickerContext) return true;
                if (pickerContext.media_type === 'both') return true;
                if (pickerContext.media_type === 'movie') return i.type === 'movie';
                if (pickerContext.media_type === 'tv') return i.type === 'tv';
                return i.type === pickerContext.media_type;
              }).map((item:any)=> (
                <button key={`${item.type}-${item.id}`} onClick={()=>setPickerSelected(item)}
                  className={`text-left rounded overflow-hidden border transition-colors ${
                    pickerSelected?.id===item.id
                      ? 'border-blue-600 ring-2 ring-blue-200'
                      : 'border-gray-600 hover:border-gray-500'
                  }`}>
                  <div className={`w-full aspect-[2/3] bg-gray-700`}>
                    {item.poster ? (
                      <img src={item.poster} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className={`w-full h-full flex items-center justify-center text-sm text-gray-600 dark:text-gray-400`}>
                        无海报
                      </div>
                    )}
                  </div>
                  <div className="p-2 text-sm">
                    <div className={`font-medium line-clamp-2 text-gray-800 dark:text-white`}>
                      {item.title}
                    </div>
                    <div className={`text-gray-600 dark:text-gray-400`}>
                      {item.type.toUpperCase()} {item.year||''}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4 py-3 px-2">
              <button 
                className={`px-3 py-2 rounded transition-colors bg-gray-700 text-gray-200 hover:bg-gray-600`} 
                onClick={()=>setPickerOpen(false)}
              >
                取消
              </button>
              <button 
                className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 transition-colors" 
                disabled={!pickerSelected || !pickerContext || !pickerRank}
                onClick={async ()=> {
                  if (pickerContext && pickerRank && pickerSelected) {
                    await addEntry(
                      pickerContext.platform,
                      pickerContext.chart_name,
                      pickerContext.media_type === 'both' ? pickerSelected.type : pickerContext.media_type,
                      pickerRank,
                      pickerSelected
                    );
                    setPickerOpen(false);
                  }
                }}
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
