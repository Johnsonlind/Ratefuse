// ==========================================
// 管理端榜单管理页
// ==========================================
import { useEffect, useState, useMemo, useRef } from 'react';
import { useAuth } from '../../modules/auth/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ThemeToggle } from '../../shared/ui/ThemeToggle';
import { useDebounce } from '../../shared/hooks/useDebounce';
import { CardTabs } from '../../shared/ui/CardTabs';
import { Button } from '../../shared/ui/Button';
import { Input } from '../../shared/ui/Input';
import { adminSearchMedia } from '../../api/adminSearch';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { formatChinaDateTime } from '../../shared/utils/time';
import { posterPathToSiteUrl } from '../../api/image';
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd';

interface MediaItem {
  id: number;
  type: 'movie' | 'tv';
  title: string;
  poster: string;
  year?: number;
}
interface ChartEntry {
  id?: number;
  tmdb_id: number;
  rank: number;
  title: string;
  poster: string;
  locked?: boolean;
}

type SectionType = 'movie' | 'tv' | 'both';
type InputMode = 'auto' | 'manual' | 'both';
type LayoutType = 'table' | 'card';
type UpdateMode = 'single' | 'all';
type EnumOption = { value: string; label: string };
type ChartSectionConfig = {
  id: string;
  name: string;
  updater_key?: string;
  media_type: SectionType;
  visible: boolean;
  input_mode: InputMode;
  layout: LayoutType;
  table_rows: number;
  card_count: number;
  update_mode: UpdateMode;
  exportable: boolean;
  rank_label_mode: 'number' | 'month';
};
type ChartPlatformConfig = { platform: string; sections: ChartSectionConfig[] };

const PLATFORM_LOGOS: Record<string, string> = {
  '豆瓣': '/logos/douban.png',
  'IMDb': '/logos/imdb.png',
  'Rotten Tomatoes': '/logos/rottentomatoes.png',
  'Metacritic': '/logos/metacritic.png',
  'Letterboxd': '/logos/letterboxd.png',
  'TMDB': '/logos/tmdb.png',
  'Trakt': '/logos/trakt.png',
};
const PLATFORM_ORDER = ['豆瓣', 'IMDb', 'Rotten Tomatoes', 'Metacritic', 'Letterboxd', 'TMDB', 'Trakt'];
const SCHEDULER_UPDATE_LABEL = '每天 21:30 (北京时间)';
const ANTI_SCRAPING_VERIFY_URL = 'https://movie.douban.com/';
const ENUM_OPTIONS = {
  media_types: [
    { value: 'movie', label: '电影' },
    { value: 'tv', label: '剧集' },
    { value: 'both', label: '混合' },
  ],
  input_modes: [
    { value: 'auto', label: '自动抓取' },
    { value: 'manual', label: '手动录入' },
    { value: 'both', label: '自动抓取和手动录入' },
  ],
  update_modes: [
    { value: 'single', label: '单独更新' },
    { value: 'all', label: '跟随全部更新' },
  ],
  layouts: [
    { value: 'table', label: '表格' },
    { value: 'card', label: '卡片' },
  ],
  rank_label_modes: [
    { value: 'number', label: '数字（1,2,3...）' },
    { value: 'month', label: '月份（1月,2月...）' },
  ],
} as const;

const PLATFORM_NAME_REVERSE_MAP: Record<string, string> = {};
const PLATFORM_NAME_MAP: Record<string, string> = {};

const CHART_NAME_REVERSE_MAP: Record<string, string> = {};
const CHART_NAME_MAP: Record<string, string> = {};

function toSectionId(platform: string, name: string) {
  return `${platform}::${name}`.replace(/\s+/g, '_');
}

function getDefaultChartConfig(): ChartPlatformConfig[] {
  return [];
}

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
  
  const [autoUpdating, setAutoUpdating] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string>('');
  const [forceRefresh, setForceRefresh] = useState(0);
  const updateControllersRef = useRef<Record<string, AbortController>>({});
  const updateOperationIdsRef = useRef<Record<string, string>>({});
  const [schedulerState, setSchedulerState] = useState<{
    running: boolean;
    next_update: string | null;
    last_update: string | null;
  } | null>(null);
  
  const [platformOperations, setPlatformOperations] = useState<Record<string, boolean>>({});
  const enumOptions: {
    media_types: EnumOption[];
    input_modes: EnumOption[];
    update_modes: EnumOption[];
    layouts: EnumOption[];
    rank_label_modes: EnumOption[];
  } = ENUM_OPTIONS as unknown as {
    media_types: EnumOption[];
    input_modes: EnumOption[];
    update_modes: EnumOption[];
    layouts: EnumOption[];
    rank_label_modes: EnumOption[];
  };
  
  const [testingNotification, setTestingNotification] = useState(false);
  const [chartConfigs, setChartConfigs] = useState<ChartPlatformConfig[]>(() => getDefaultChartConfig());
  const [configLoaded, setConfigLoaded] = useState(false);
  const [editingChart, setEditingChart] = useState<{
    platform: string;
    section: ChartSectionConfig;
    isNew: boolean;
  } | null>(null);
  
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

  async function requestCancelUpdate(operationId?: string) {
    if (!operationId) return;
    try {
      const token = localStorage.getItem('token');
      await fetch('/api/charts/cancel-update', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ operation_key: operationId }),
      });
    } catch {
    }
  }

  function buildAsciiOperationId(operationKey: string) {
    const safeRandom = Math.random().toString(36).slice(2, 10);
    return `op_${Date.now()}_${safeRandom}_${operationKey.length}`;
  }

  async function parseResponsePayload(response: Response) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { detail: text || `HTTP ${response.status}` };
    }
  }

  function apiSuccessMessage(result: unknown, fallback: string): string {
    const m = (result as { message?: unknown })?.message;
    return typeof m === 'string' && m.trim() ? m.trim() : fallback;
  }

  function looksLikeHtmlErrorPayload(result: unknown) {
    const detail = String((result as { detail?: unknown })?.detail || '').toLowerCase();
    return detail.includes('<!doctype') || detail.includes('<html') || detail.includes('gateway time-out');
  }

  async function waitForUpdateOperation(
    operationId: string,
    timeoutMs = 8 * 60 * 1000,
    onRunning?: () => void,
  ) {
    const token = localStorage.getItem('token');
    const started = Date.now();
    let runningNotified = false;
    while (Date.now() - started < timeoutMs) {
      const res = await fetch(`/api/charts/update-status/${encodeURIComponent(operationId)}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      const data = await parseResponsePayload(res);
      const state = String(data.state || 'unknown');
      if (state === 'running' || state === 'unknown') {
        if (!runningNotified && onRunning) {
          runningNotified = true;
          onRunning();
        }
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      return data;
    }
    return { state: 'timeout', message: '等待任务状态超时' };
  }

  const { data: pickerData } = useQuery({
    queryKey: ['tmdb-picker', debouncedPickerQuery],
    queryFn: () => adminSearchMedia(debouncedPickerQuery),
    enabled: pickerOpen && !!debouncedPickerQuery,
  });

  const { data: remoteConfigs } = useQuery({
    queryKey: ['admin-chart-configs'],
    queryFn: async () => {
      const res = await fetch('/api/charts/configs');
      if (!res.ok) return [];
      const rows = (await res.json()) as Array<{
        platform: string;
        chart_name: string;
        updater_key?: string;
        media_type: SectionType;
        sort_order: number;
        visible: boolean;
        input_mode: InputMode;
        layout: LayoutType;
        table_rows: number;
        card_count: number;
        update_mode: UpdateMode;
        exportable?: boolean;
      }>;
      return rows;
    },
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

  const platforms = useMemo(() => {
    const names = chartConfigs.map((item) => item.platform);
    return names.slice().sort((a, b) => {
      const ia = PLATFORM_ORDER.indexOf(a);
      const ib = PLATFORM_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [chartConfigs]);

  const [activePlatform, setActivePlatform] = useState<string>('豆瓣');

  useEffect(() => {
    if (!remoteConfigs) return;
    if (remoteConfigs.length === 0) {
      setChartConfigs(getDefaultChartConfig());
      setConfigLoaded(true);
      return;
    }
    const grouped = new Map<string, ChartSectionConfig[]>();
    remoteConfigs
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .forEach((row) => {
        const list = grouped.get(row.platform) || [];
        list.push({
          id: toSectionId(PLATFORM_NAME_MAP[row.platform] || row.platform, CHART_NAME_MAP[row.chart_name] || row.chart_name),
          name: CHART_NAME_MAP[row.chart_name] || row.chart_name,
          updater_key: row.updater_key,
          media_type: row.media_type,
          visible: row.visible,
          input_mode: row.input_mode,
          layout: row.layout,
          table_rows: row.table_rows,
          card_count: row.card_count,
          update_mode: row.update_mode,
          exportable: row.exportable ?? true,
          rank_label_mode: (row as { rank_label_mode?: 'number' | 'month' }).rank_label_mode ?? 'number',
        });
        grouped.set(PLATFORM_NAME_MAP[row.platform] || row.platform, list);
      });
    const allPlatforms = Array.from(new Set(remoteConfigs.map((x) => PLATFORM_NAME_MAP[x.platform] || x.platform)));
    const next = allPlatforms.map((p) => ({ platform: p, sections: grouped.get(p) || [] }));
    setChartConfigs(next);
    setConfigLoaded(true);
  }, [remoteConfigs]);

  useEffect(() => {
    if (!configLoaded) return;
    const run = async () => {
      const items = chartConfigs.flatMap((cfg) =>
        cfg.sections.map((sec, index) => ({
          platform: PLATFORM_NAME_REVERSE_MAP[cfg.platform] || cfg.platform,
          chart_name: CHART_NAME_REVERSE_MAP[sec.name] || sec.name,
          media_type: sec.media_type,
          sort_order: index,
          visible: sec.visible,
          input_mode: sec.input_mode,
          layout: sec.layout,
          table_rows: sec.table_rows,
          card_count: sec.card_count,
          update_mode: sec.update_mode,
          updater_key: sec.updater_key,
          exportable: sec.exportable,
          rank_label_mode: sec.rank_label_mode,
        })),
      );
      const token = localStorage.getItem('token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch('/api/charts/configs', {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail =
          (err && (err.detail || err.message))
            ? (err.detail || err.message)
            : `保存榜单配置失败（${res.status}）`;
        console.error('保存榜单配置失败:', detail);
      }
    };
    void run();
  }, [chartConfigs, configLoaded]);

  useEffect(() => {
    const ordered = PLATFORM_ORDER.filter((p) => chartConfigs.some((cfg) => cfg.platform === p));
    const fallback = ordered[0] ?? chartConfigs[0]?.platform ?? '';
    if (!chartConfigs.some((cfg) => cfg.platform === activePlatform)) {
      setActivePlatform(fallback);
    }
  }, [chartConfigs, activePlatform]);

  const activePlatformConfig = chartConfigs.find(
    ({ platform }) => platform === activePlatform,
  );

  if (isLoading) return <div className="p-4">加载中...</div>;
  if (!user?.is_admin) return <div className="p-4 text-red-500">无权限（仅管理员可访问）</div>;

  async function addEntry(platform: string, chart_name: string, media_type: 'movie' | 'tv', rank: number, item?: MediaItem) {
    if (!item) return;
    const choice = { id: item.id };
    
    const conflictExists = (media_type === 'movie' ? currentListsByType.movie : currentListsByType.tv).some(i => i.rank === rank);
    
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
        await loadCurrentList(currentPlatform, currentChartName, currentMediaType as SectionType);
      }
      
      queryClient.invalidateQueries({ 
        queryKey: ['aggregate-charts'],
        refetchType: 'active'
      });
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
    setPickerContext({ platform, chart_name, media_type });
    setPickerQuery('');
    setPickerSelected(null);
  }

  async function handleAutoUpdateAll() {
    const operationKey = 'all_update';
    if (platformOperations[operationKey]) {
      const operationId = updateOperationIdsRef.current[operationKey];
      const controller = updateControllersRef.current[operationKey];
      controller?.abort();
      await requestCancelUpdate(operationId);
      return;
    }

    const operationId = buildAsciiOperationId(operationKey);
    const controller = new AbortController();
    updateControllersRef.current[operationKey] = controller;
    updateOperationIdsRef.current[operationKey] = operationId;
    setPlatformOperations((prev) => ({ ...prev, [operationKey]: true }));
    setAutoUpdating(true);
    setUpdateStatus('正在更新设置为「跟随全部更新」的榜单…');
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/charts/auto-update', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Update-Operation-Key': operationId,
        },
        signal: controller.signal,
      });
      
      const result = await parseResponsePayload(response);
      
      if (response.ok) {
        setUpdateStatus(apiSuccessMessage(result, '更新完成'));
        if (activeKey) {
          const [platform, chart_name, media_type] = activeKey.split(':');
          loadCurrentList(platform, chart_name, media_type as SectionType);
        }
      } else if (looksLikeHtmlErrorPayload(result) || response.status >= 502) {
        setUpdateStatus('连接中断，正在确认后台任务状态...');
        const finalState = await waitForUpdateOperation(
          operationId,
          8 * 60 * 1000,
          () => setUpdateStatus('后台仍在更新跟榜批量任务，正在持续确认状态…'),
        );
        const state = String(finalState.state || 'unknown');
        if (state === 'success') {
          setUpdateStatus(apiSuccessMessage(finalState, '更新完成'));
          if (activeKey) {
            const [platform, chart_name, media_type] = activeKey.split(':');
            loadCurrentList(platform, chart_name, media_type as SectionType);
          }
        } else if (state === 'cancelled') {
          setUpdateStatus('已取消跟榜批量更新');
        } else if (state === 'running') {
          setUpdateStatus('跟榜批量更新仍在进行中');
        } else {
          setUpdateStatus(`更新失败: ${String(finalState.message || result.detail || '未知错误')}`);
        }
      } else {
        setUpdateStatus(`更新失败: ${result.detail || '未知错误'}`);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setUpdateStatus('已取消跟榜批量更新');
      } else {
        setUpdateStatus('连接中断，正在确认后台任务状态...');
        const finalState = await waitForUpdateOperation(
          operationId,
          8 * 60 * 1000,
          () => setUpdateStatus('后台仍在更新跟榜批量任务，正在持续确认状态…'),
        );
        const state = String(finalState.state || 'unknown');
        if (state === 'success') {
          setUpdateStatus(apiSuccessMessage(finalState, '更新完成'));
          if (activeKey) {
            const [platform, chart_name, media_type] = activeKey.split(':');
            loadCurrentList(platform, chart_name, media_type as SectionType);
          }
        } else if (state === 'cancelled') {
          setUpdateStatus('已取消跟榜批量更新');
        } else if (state === 'running') {
          setUpdateStatus('跟榜批量更新仍在进行中');
        } else {
          setUpdateStatus(`更新失败: ${String(finalState.message || error)}`);
        }
      }
    } finally {
      delete updateControllersRef.current[operationKey];
      delete updateOperationIdsRef.current[operationKey];
      setPlatformOperations((prev) => ({ ...prev, [operationKey]: false }));
      setAutoUpdating(false);
      setTimeout(() => setUpdateStatus(''), 3000);
    }
  }

  async function handleAutoUpdatePlatform(platform: string) {
    const operationKey = `${platform}_update`;
    if (platformOperations[operationKey]) {
      const operationId = updateOperationIdsRef.current[operationKey];
      const controller = updateControllersRef.current[operationKey];
      controller?.abort();
      await requestCancelUpdate(operationId);
      return;
    }

    const operationId = buildAsciiOperationId(operationKey);
    const controller = new AbortController();
    updateControllersRef.current[operationKey] = controller;
    updateOperationIdsRef.current[operationKey] = operationId;
    setPlatformOperations(prev => ({ ...prev, [operationKey]: true }));
    setUpdateStatus(`正在更新 ${platform} 下「跟随全部更新」的榜单…`);
    
    try {
      const token = localStorage.getItem('token');
      const backendPlatform = PLATFORM_NAME_REVERSE_MAP[platform] || platform;
      const response = await fetch(`/api/charts/auto-update/${backendPlatform}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Update-Operation-Key': operationId,
        },
        signal: controller.signal,
      });
      
      const result = await parseResponsePayload(response);
      
      if (response.ok) {
        setUpdateStatus(apiSuccessMessage(result, `${platform} 榜单更新完成`));
        if (activeKey) {
          const [currentPlatform, chart_name, media_type] = activeKey.split(':');
          if (currentPlatform === platform) {
            loadCurrentList(currentPlatform, chart_name, media_type as SectionType);
          }
        }
      } else if (looksLikeHtmlErrorPayload(result) || response.status >= 502) {
        setUpdateStatus(`连接中断，正在确认 ${platform} 任务状态...`);
        const finalState = await waitForUpdateOperation(
          operationId,
          8 * 60 * 1000,
          () => setUpdateStatus(`后台仍在更新 ${platform} 跟榜任务，正在持续确认状态…`),
        );
        const state = String(finalState.state || 'unknown');
        if (state === 'success') {
          setUpdateStatus(apiSuccessMessage(finalState, `${platform} 榜单更新完成`));
          if (activeKey) {
            const [currentPlatform, chart_name, media_type] = activeKey.split(':');
            if (currentPlatform === platform) {
              loadCurrentList(currentPlatform, chart_name, media_type as SectionType);
            }
          }
        } else if (state === 'cancelled') {
          setUpdateStatus(`已取消更新 ${platform} 榜单`);
        } else if (state === 'running') {
          setUpdateStatus(`更新仍在进行中：${platform}`);
        } else {
          setUpdateStatus(`更新失败: ${String(finalState.message || result.detail || '未知错误')}`);
        }
      } else {
        setUpdateStatus(`更新失败: ${result.detail || '未知错误'}`);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setUpdateStatus(`已取消更新 ${platform} 榜单`);
      } else {
        setUpdateStatus(`连接中断，正在确认 ${platform} 任务状态...`);
        const finalState = await waitForUpdateOperation(
          operationId,
          8 * 60 * 1000,
          () => setUpdateStatus(`后台仍在更新 ${platform} 跟榜任务，正在持续确认状态…`),
        );
        const state = String(finalState.state || 'unknown');
        if (state === 'success') {
          setUpdateStatus(apiSuccessMessage(finalState, `${platform} 榜单更新完成`));
          if (activeKey) {
            const [currentPlatform, chart_name, media_type] = activeKey.split(':');
            if (currentPlatform === platform) {
              loadCurrentList(currentPlatform, chart_name, media_type as SectionType);
            }
          }
        } else if (state === 'cancelled') {
          setUpdateStatus(`已取消更新 ${platform} 榜单`);
        } else if (state === 'running') {
          setUpdateStatus(`更新仍在进行中：${platform}`);
        } else {
          setUpdateStatus(`更新失败: ${String(finalState.message || error)}`);
        }
      }
    } finally {
      delete updateControllersRef.current[operationKey];
      delete updateOperationIdsRef.current[operationKey];
      setPlatformOperations(prev => ({ ...prev, [operationKey]: false }));
      setTimeout(() => setUpdateStatus(''), 3000);
    }
  }

  async function handleUpdateSingleChart(platform: string, chartName: string, updaterKey?: string) {
    const operationKey = `${platform}_${chartName}_update`;
    if (platformOperations[operationKey]) {
      const operationId = updateOperationIdsRef.current[operationKey];
      const controller = updateControllersRef.current[operationKey];
      controller?.abort();
      await requestCancelUpdate(operationId);
      return;
    }

    const operationId = buildAsciiOperationId(operationKey);
    const controller = new AbortController();
    updateControllersRef.current[operationKey] = controller;
    updateOperationIdsRef.current[operationKey] = operationId;
    setPlatformOperations(prev => ({ ...prev, [operationKey]: true }));
    setUpdateStatus(`正在更新 ${chartName}...`);
    
    try {
      const token = localStorage.getItem('token');
      const backendPlatform = PLATFORM_NAME_REVERSE_MAP[platform] || platform;
      const backendChartName = CHART_NAME_REVERSE_MAP[chartName] || chartName;
      
      const response = await fetch(`/api/charts/update-chart`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Update-Operation-Key': operationId,
        },
        body: JSON.stringify({
          platform: backendPlatform,
          chart_name: backendChartName,
          updater_key: updaterKey || null,
        }),
        signal: controller.signal,
      });
      
      const result = await parseResponsePayload(response);
      
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
      } else if (looksLikeHtmlErrorPayload(result) || response.status >= 502) {
        setUpdateStatus(`连接中断，正在确认 ${chartName} 任务状态...`);
        const finalState = await waitForUpdateOperation(
          operationId,
          8 * 60 * 1000,
          () => setUpdateStatus(`后台仍在更新 ${chartName}，正在持续确认状态...`),
        );
        const state = String(finalState.state || 'unknown');
        if (state === 'success') {
          setUpdateStatus(`${chartName} 更新成功！`);
          setAntiScrapingState(null);
          if (activeKey) {
            const [currentPlatform, currentChartName, media_type] = activeKey.split(':');
            if (currentPlatform === platform && currentChartName === chartName) {
              loadCurrentList(currentPlatform, currentChartName, media_type as SectionType);
            }
          }
        } else if (state === 'cancelled') {
          setUpdateStatus(`已取消更新 ${chartName}`);
        } else if (state === 'running') {
          setUpdateStatus(`更新仍在进行中：${chartName}`);
        } else {
          setUpdateStatus(`更新失败: ${String(finalState.message || result.detail || '未知错误')}`);
        }
      } else {
        setUpdateStatus(`更新失败: ${result.detail?.message || result.detail || '未知错误'}`);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setUpdateStatus(`已取消更新 ${chartName}`);
      } else {
        setUpdateStatus('连接中断，正在确认后台任务状态...');
        const finalState = await waitForUpdateOperation(
          operationId,
          8 * 60 * 1000,
          () => setUpdateStatus(`后台仍在更新 ${chartName}，正在持续确认状态...`),
        );
        const state = String(finalState.state || 'unknown');
        if (state === 'success') {
          setUpdateStatus(`${chartName} 更新成功！`);
          if (activeKey) {
            const [currentPlatform, currentChartName, media_type] = activeKey.split(':');
            if (currentPlatform === platform && currentChartName === chartName) {
              loadCurrentList(currentPlatform, currentChartName, media_type as SectionType);
            }
          }
        } else if (state === 'cancelled') {
          setUpdateStatus(`已取消更新 ${chartName}`);
        } else if (state === 'running') {
          setUpdateStatus(`更新仍在进行中：${chartName}`);
        } else {
          setUpdateStatus(`更新失败: ${String(finalState.message || error)}`);
        }
      }
    } finally {
      delete updateControllersRef.current[operationKey];
      delete updateOperationIdsRef.current[operationKey];
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
      window.open(ANTI_SCRAPING_VERIFY_URL, '_blank');
      setAntiScrapingState(prev => prev ? { ...prev, verificationStarted: true } : null);
    }
  }
  
  async function handleCompleteVerification() {
    if (antiScrapingState) {
      await handleUpdateSingleChart(antiScrapingState.platform, antiScrapingState.chartName);
      setAntiScrapingState(null);
    }
  }

  async function handleClearSingleChart(platform: string, chartName: string) {
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
            
            const response = await fetch(`/api/charts/clear-chart`, {
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
      
      const shouldLoadBoth = media_type === 'both';
      
      if (shouldLoadBoth) {
        const [movieResponse, tvResponse] = await Promise.all([
          fetch(`/api/charts/entries?platform=${encodeURIComponent(backendPlatform)}&chart_name=${encodeURIComponent(backendChartName)}&media_type=movie`, { headers: authHeaders }),
          fetch(`/api/charts/entries?platform=${encodeURIComponent(backendPlatform)}&chart_name=${encodeURIComponent(backendChartName)}&media_type=tv`, { headers: authHeaders })
        ]);
        
        const movies: ChartEntry[] = movieResponse.ok ? await movieResponse.json() : [];
        const tvs: ChartEntry[] = tvResponse.ok ? await tvResponse.json() : [];
        
        const byRank: Record<number, ChartEntry> = {};
        [...movies, ...tvs].forEach((i) => {
          if (!byRank[i.rank] || (byRank[i.rank].id ?? 0) < (i.id ?? 0)) {
            byRank[i.rank] = i;
          }
        });
        const merged = Array.from({ length: 250 }, (_, idx) => byRank[idx + 1]).filter(Boolean).map((i) => ({ 
          tmdb_id: i.tmdb_id, 
          rank: i.rank, 
          title: i.title, 
          poster: i.poster, 
          locked: i.locked 
        }));
        
        setCurrentList(merged);
        setCurrentListsByType({
          movie: movies.map((i) => ({ tmdb_id: i.tmdb_id, rank: i.rank, title: i.title, poster: i.poster, locked: i.locked })),
          tv: tvs.map((i) => ({ tmdb_id: i.tmdb_id, rank: i.rank, title: i.title, poster: i.poster, locked: i.locked })),
        });
      } else {
        const response = await fetch(`/api/charts/entries?platform=${encodeURIComponent(backendPlatform)}&chart_name=${encodeURIComponent(backendChartName)}&media_type=${media_type}`, {
          headers: authHeaders,
        });
        
        if (response.ok) {
          const data: ChartEntry[] = await response.json();
          setCurrentList(data.map((i) => ({ 
            tmdb_id: i.tmdb_id, 
            rank: i.rank, 
            title: i.title, 
            poster: i.poster, 
            locked: i.locked 
          })));
          
          setCurrentListsByType(prev => ({
            movie: media_type === 'movie' ? data.map((i) => ({ tmdb_id: i.tmdb_id, rank: i.rank, title: i.title, poster: i.poster, locked: i.locked })) : prev.movie,
            tv: media_type === 'tv' ? data.map((i) => ({ tmdb_id: i.tmdb_id, rank: i.rank, title: i.title, poster: i.poster, locked: i.locked })) : prev.tv,
          }));
        }
      }
    } catch (error) {
      console.error('加载榜单数据失败:', error);
    }
  }

  async function handleSyncCharts() {
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetch('/api/charts/sync', {
        method: 'POST',
        headers,
        credentials: 'include',
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

  function updatePlatformSections(platform: string, updater: (sections: ChartSectionConfig[]) => ChartSectionConfig[]) {
    setChartConfigs((prev) =>
      prev.map((item) => (item.platform === platform ? { ...item, sections: updater(item.sections) } : item)),
    );
  }

  function handleDeleteSection(platform: string, sectionId: string) {
    updatePlatformSections(platform, (sections) => sections.filter((s) => s.id !== sectionId));
  }

  function handleToggleVisible(platform: string, sectionId: string) {
    updatePlatformSections(platform, (sections) =>
      sections.map((s) => (s.id === sectionId ? { ...s, visible: !s.visible } : s)),
    );
  }

  function handleSaveSectionConfig() {
    if (!editingChart) return;
    const { platform, section, isNew } = editingChart;
    if (!section.name.trim()) {
      showAlert('榜单名称不能为空');
      return;
    }
    if (section.layout === 'table' && section.table_rows < 1) {
      showAlert('表格行数必须大于 0');
      return;
    }
    if (section.layout === 'card' && section.card_count < 1) {
      showAlert('卡片数量必须大于 0');
      return;
    }

    updatePlatformSections(platform, (sections) => {
      if (isNew) return [...sections, section];
      return sections.map((s) => (s.id === section.id ? section : s));
    });
    setEditingChart(null);
  }

  function handleSectionDragEnd(result: DropResult) {
    if (!result.destination) return;
    const sourceIndex = result.source.index;
    const destinationIndex = result.destination.index;
    if (sourceIndex === destinationIndex || !activePlatformConfig) return;
    updatePlatformSections(activePlatformConfig.platform, (sections) => {
      const next = [...sections];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(destinationIndex, 0, moved);
      return next;
    });
  }

  function formatRankLabel(sec: ChartSectionConfig, rank: number) {
    if (sec.rank_label_mode === 'month') return `${rank}月`;
    return String(rank);
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
        
          <div className="flex items-center gap-4">
          
          {updateStatus && (
            <div className={`px-3 py-1 rounded text-sm bg-blue-900 text-blue-200`}>
              {updateStatus}
            </div>
          )}
          
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
                className={`px-4 py-2 rounded font-medium transition-colors ${autoUpdating ? 'bg-orange-600 text-white hover:bg-orange-700' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
              >
                {autoUpdating ? '取消更新' : '更新'}
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
                更新时间: {SCHEDULER_UPDATE_LABEL}
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
                    className={`text-sm px-3 py-1 rounded transition-colors ${platformOperations[`${platform}_update`] ? 'bg-orange-600 text-white hover:bg-orange-500' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
                  >
                    {platformOperations[`${platform}_update`] ? '取消更新' : `更新`}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div className="border rounded p-3 glass-card">
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-medium text-gray-800 dark:text-white">榜单配置管理</div>
                    <Button
                      type="button"
                      onClick={() =>
                        setEditingChart({
                          platform,
                          isNew: true,
                          section: {
                            id: `${Date.now()}`,
                            name: '',
                            updater_key: undefined,
                            media_type: 'movie',
                            visible: true,
                            input_mode: 'auto',
                            layout: 'card',
                            table_rows: 10,
                            card_count: 10,
                            update_mode: 'all',
                            exportable: true,
                            rank_label_mode: 'number',
                          },
                        })
                      }
                    >
                      新建榜单
                    </Button>
                  </div>
                  <DragDropContext onDragEnd={handleSectionDragEnd}>
                    <Droppable droppableId={`config-${platform}`}>
                      {(provided) => (
                        <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
                          {activePlatformConfig.sections.map((sec, index) => {
                            const key = `${platform}:${sec.name}:${sec.media_type}`;
                            return (
                            <Draggable key={sec.id} draggableId={sec.id} index={index}>
                              {(dragProvided) => (
                                <div ref={dragProvided.innerRef} {...dragProvided.draggableProps} className="rounded border border-gray-300 dark:border-gray-700">
                                  <div className="flex items-center justify-between px-3 py-2">
                                    <div className="flex items-center gap-3">
                                      <span {...dragProvided.dragHandleProps} className="cursor-grab text-gray-500">⋮⋮</span>
                                      <div className="text-sm text-gray-900 dark:text-white">{sec.name}</div>
                                      <div className="text-xs text-gray-500">
                                        {sec.layout === 'table' ? `表格 ${sec.table_rows} 行` : `卡片 ${sec.card_count} 个`} · {sec.input_mode}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                    {sec.update_mode === 'single' && (
                                      <>
                                        {sec.input_mode !== 'manual' && (
                                          <button
                                            onClick={() => handleUpdateSingleChart(platform, sec.name, sec.updater_key)}
                                            className={`text-xs px-2 py-1 rounded transition-colors ${
                                              platformOperations[`${platform}_${sec.name}_update`]
                                                ? 'bg-orange-600 text-white hover:bg-orange-500'
                                                : 'bg-orange-600 text-white hover:bg-orange-500'
                                            }`}
                                          >
                                            {platformOperations[`${platform}_${sec.name}_update`] ? '取消更新' : '更新'}
                                          </button>
                                        )}
                                        <button
                                          onClick={() => handleClearSingleChart(platform, sec.name)}
                                          disabled={platformOperations[`${platform}_${sec.name}_clear`]}
                                          className={`text-xs px-2 py-1 rounded transition-colors ${
                                            platformOperations[`${platform}_${sec.name}_clear`]
                                              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                              : 'bg-red-600 text-white hover:bg-red-500'
                                          }`}
                                        >
                                          {platformOperations[`${platform}_${sec.name}_clear`] ? '清空中...' : '清空'}
                                        </button>
                                      </>
                                    )}
                                    <button
                                      onClick={() => {
                                        setActiveKey((prev) => (prev === key ? '' : key));
                                      }}
                                      className="text-xs px-2 py-1 rounded bg-green-700 text-white hover:bg-green-600"
                                    >
                                      {activeKey === key ? '收起录入' : '展开录入'}
                                    </button>
                                    <button
                                      onClick={() => handleToggleVisible(platform, sec.id)}
                                      className="text-xs px-2 py-1 rounded bg-gray-600 text-white hover:bg-gray-500"
                                    >
                                      {sec.visible ? '隐藏' : '显示'}
                                    </button>
                                    <button
                                      onClick={() => setEditingChart({ platform, section: sec, isNew: false })}
                                      className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-500"
                                    >
                                      编辑
                                    </button>
                                    <button
                                      onClick={() => handleDeleteSection(platform, sec.id)}
                                      className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-500"
                                    >
                                      删除
                                    </button>
                                    </div>
                                  </div>
                                  {activeKey === key && (
                                    <div className="border-t border-gray-300 dark:border-gray-700 p-3">
                                      <div className="text-xs text-gray-500 mb-2">录入面板</div>
                                      {sec.layout === 'table' ? (
                                        <div className="overflow-x-auto max-h-[70vh] overflow-y-auto scrollbar-gentle">
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
                                              {Array.from({ length: sec.table_rows }, (_, idx) => idx + 1).map((r) => {
                                                const current = currentList.find((i) => i.rank === r);
                                                const locked = (sec.media_type === 'movie'
                                                  ? currentListsByType.movie
                                                  : sec.media_type === 'tv'
                                                    ? currentListsByType.tv
                                                    : currentList
                                                ).some((i) => i.rank === r && i.locked);
                                                return (
                                                  <tr key={r} className={`border-b border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800/30 ${current ? '' : 'opacity-60'}`}>
                                                    <td className={`py-2 px-3 text-sm text-gray-900 dark:text-white font-medium text-center`}>{formatRankLabel(sec, r)}</td>
                                                    <td className={`py-2 px-3`}>
                                                      <div className={`w-12 h-18 overflow-hidden rounded bg-gray-700`}>
                                                        {current?.poster ? <img src={posterPathToSiteUrl(current.poster, 'w185')} alt="thumb" className="w-full h-full object-cover" /> : <div className={`w-full h-full flex items-center justify-center text-[10px] text-gray-500`}>无</div>}
                                                      </div>
                                                    </td>
                                                    <td className={`py-2 px-3 text-sm text-gray-900 dark:text-white`}>{current?.title || <span className="text-gray-500 dark:text-gray-400">-</span>}</td>
                                                    <td className={`py-2 px-3`}>
                                                      <div className="flex gap-1 items-center whitespace-nowrap">
                                                        {sec.input_mode !== 'auto' && <button disabled={locked} onClick={() => openPicker(platform, sec.name, sec.media_type, r)} className={`px-2 py-1 rounded text-xs transition-colors ${locked ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}>{current ? '修改' : '选择'}</button>}
                                                        {current && <button onClick={async () => {
                                                          const effectiveType = sec.media_type === 'both' ? (currentListsByType.movie.find((i) => i.rank === r) ? 'movie' : 'tv') : sec.media_type;
                                                          const backendPlatform = PLATFORM_NAME_REVERSE_MAP[platform] || platform;
                                                          const backendChartName = CHART_NAME_REVERSE_MAP[sec.name] || sec.name;
                                                          await fetch(`/api/charts/entries/lock?platform=${encodeURIComponent(backendPlatform)}&chart_name=${encodeURIComponent(backendChartName)}&media_type=${encodeURIComponent(effectiveType)}&rank=${r}&locked=${!locked}`, { method: 'PUT', headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } });
                                                          setSubmitting((s) => !s);
                                                        }} className={`px-2 py-1 rounded text-xs transition-colors ${locked ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-blue-500 text-white hover:bg-blue-600'}`}>{locked ? '解锁' : '锁定'}</button>}
                                                        {current && !locked && <button onClick={async () => {
                                                          const effectiveType = sec.media_type === 'both' ? (currentListsByType.movie.find((i) => i.rank === r) ? 'movie' : 'tv') : sec.media_type;
                                                          const backendPlatform = PLATFORM_NAME_REVERSE_MAP[platform] || platform;
                                                          const backendChartName = CHART_NAME_REVERSE_MAP[sec.name] || sec.name;
                                                          await fetch(`/api/charts/entries?platform=${encodeURIComponent(backendPlatform)}&chart_name=${encodeURIComponent(backendChartName)}&media_type=${encodeURIComponent(effectiveType)}&rank=${r}`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } });
                                                          setSubmitting((s) => !s);
                                                        }} className="px-2 py-1 rounded text-xs transition-colors bg-gray-600 text-gray-200 hover:bg-gray-500">清空</button>}
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
                                          {Array.from({ length: sec.card_count }, (_, idx) => idx + 1).map((r) => {
                                            const current = currentList.find((i) => i.rank === r);
                                            const locked = (sec.media_type === 'movie' ? currentListsByType.movie : sec.media_type === 'tv' ? currentListsByType.tv : currentList).some((i) => i.rank === r && i.locked);
                                            return (
                                              <div key={r} className="flex flex-col items-center">
                                                <div className={`w-12 h-18 overflow-hidden rounded mb-1 bg-gray-700`}>{current?.poster ? <img src={posterPathToSiteUrl(current.poster, 'w185')} alt="thumb" className="w-full h-full object-cover" /> : <div className={`w-full h-full flex items-center justify-center text-[10px] text-gray-500`}>无</div>}</div>
                                                <div className="flex gap-1 flex-nowrap justify-center">
                                                  {sec.input_mode !== 'auto' && <button disabled={locked} onClick={() => openPicker(platform, sec.name, sec.media_type, r)} className={`shrink-0 min-w-[2.75rem] sm:min-w-[3.25rem] px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-xs sm:text-sm transition-colors ${locked ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}>排名{formatRankLabel(sec, r)}</button>}
                                                  {current && <button onClick={async () => {
                                                    const effectiveType =
                                                      sec.media_type === 'both'
                                                        ? current?.title
                                                          ? currentListsByType.movie.find((i) => i.rank === r)
                                                            ? 'movie'
                                                            : 'tv'
                                                          : 'movie'
                                                        : sec.media_type;
                                                    const backendPlatform = PLATFORM_NAME_REVERSE_MAP[platform] || platform;
                                                    const backendChartName = CHART_NAME_REVERSE_MAP[sec.name] || sec.name;
                                                    await fetch(
                                                      `/api/charts/entries/lock?platform=${encodeURIComponent(backendPlatform)}&chart_name=${encodeURIComponent(backendChartName)}&media_type=${encodeURIComponent(effectiveType)}&rank=${r}&locked=${!locked}`,
                                                      { method: 'PUT', headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } },
                                                    );
                                                    setSubmitting((s) => !s);
                                                  }} className={`shrink-0 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-xs sm:text-sm transition-colors whitespace-nowrap ${locked ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-blue-500 text-white hover:bg-blue-600'}`}>{locked ? '解锁' : '锁定'}</button>}
                                                  {current && !locked && <button onClick={async () => {
                                                    const effectiveType = sec.media_type === 'both' ? (currentListsByType.movie.find((i) => i.rank === r) ? 'movie' : 'tv') : sec.media_type;
                                                    const backendPlatform = PLATFORM_NAME_REVERSE_MAP[platform] || platform;
                                                    const backendChartName = CHART_NAME_REVERSE_MAP[sec.name] || sec.name;
                                                    await fetch(
                                                      `/api/charts/entries?platform=${encodeURIComponent(backendPlatform)}&chart_name=${encodeURIComponent(backendChartName)}&media_type=${encodeURIComponent(effectiveType)}&rank=${r}`,
                                                      { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } },
                                                    );
                                                    setSubmitting((s) => !s);
                                                  }} className={`shrink-0 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-xs sm:text-sm transition-colors whitespace-nowrap bg-gray-600 text-gray-200 hover:bg-gray-500`}>清空</button>}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                      <div className={`text-xs mt-2 text-gray-600 dark:text-gray-400`}>
                                        {sec.layout === 'table'
                                          ? '提示：点击"选择/修改"后搜索影视，排名由表格行号决定。'
                                          : '提示：点击排名按钮后进行搜索选择并完成。'}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </Draggable>
                          )})}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </DragDropContext>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

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
              {[...(pickerData?.movies.results || []), ...(pickerData?.tvShows.results || [])].filter((i: MediaItem) => {
                if (!pickerContext) return true;
                if (pickerContext.media_type === 'both') return true;
                if (pickerContext.media_type === 'movie') return i.type === 'movie';
                if (pickerContext.media_type === 'tv') return i.type === 'tv';
                return i.type === pickerContext.media_type;
              }).map((item: MediaItem) => (
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
      {editingChart && (
        <div className="modal-root fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="modal-card w-full max-w-2xl rounded-lg p-4 glass-card overflow-visible">
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-semibold text-gray-800 dark:text-white">
                {editingChart.isNew ? '新建榜单' : '编辑榜单'}
              </div>
              <button onClick={() => setEditingChart(null)} className="text-gray-600 dark:text-gray-400">
                关闭
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="榜单名称"
                value={editingChart.section.name}
                onChange={(e) =>
                  setEditingChart((prev) =>
                    prev ? { ...prev, section: { ...prev.section, name: e.target.value } } : prev,
                  )
                }
              />
              <div>
                <label className="block text-sm mb-1 text-gray-700 dark:text-gray-300">影视类型</label>
                <select
                  className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-800"
                  value={editingChart.section.media_type}
                  onChange={(e) =>
                    setEditingChart((prev) =>
                      prev ? { ...prev, section: { ...prev.section, media_type: e.target.value as SectionType } } : prev,
                    )
                  }
                >
                  {enumOptions.media_types.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-700 dark:text-gray-300">录入方式</label>
                <select
                  className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-800"
                  value={editingChart.section.input_mode}
                  onChange={(e) =>
                    setEditingChart((prev) =>
                      prev ? { ...prev, section: { ...prev.section, input_mode: e.target.value as InputMode } } : prev,
                    )
                  }
                >
                  {enumOptions.input_modes.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-700 dark:text-gray-300">更新模式</label>
                <select
                  className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-800"
                  value={editingChart.section.update_mode}
                  onChange={(e) =>
                    setEditingChart((prev) =>
                      prev ? { ...prev, section: { ...prev.section, update_mode: e.target.value as UpdateMode } } : prev,
                    )
                  }
                >
                  {enumOptions.update_modes.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-700 dark:text-gray-300">展示形式</label>
                <select
                  className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-800"
                  value={editingChart.section.layout}
                  onChange={(e) =>
                    setEditingChart((prev) =>
                      prev ? { ...prev, section: { ...prev.section, layout: e.target.value as LayoutType } } : prev,
                    )
                  }
                >
                  {enumOptions.layouts.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              {editingChart.section.layout === 'table' ? (
                <Input
                  label="表格行数"
                  type="number"
                  value={String(editingChart.section.table_rows)}
                  onChange={(e) =>
                    setEditingChart((prev) =>
                      prev ? { ...prev, section: { ...prev.section, table_rows: Number(e.target.value) || 1 } } : prev,
                    )
                  }
                />
              ) : (
                <Input
                  label="卡片数量"
                  type="number"
                  value={String(editingChart.section.card_count)}
                  onChange={(e) =>
                    setEditingChart((prev) =>
                      prev ? { ...prev, section: { ...prev.section, card_count: Number(e.target.value) || 1 } } : prev,
                    )
                  }
                />
              )}
              <div>
                <label className="block text-sm mb-1 text-gray-700 dark:text-gray-300">是否可导出</label>
                <select
                  className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-800"
                  value={editingChart.section.exportable ? 'yes' : 'no'}
                  onChange={(e) =>
                    setEditingChart((prev) =>
                      prev ? { ...prev, section: { ...prev.section, exportable: e.target.value === 'yes' } } : prev,
                    )
                  }
                >
                  <option value="yes">可导出</option>
                  <option value="no">不可导出</option>
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-700 dark:text-gray-300">排名显示格式</label>
                <select
                  className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-800"
                  value={editingChart.section.rank_label_mode}
                  onChange={(e) =>
                    setEditingChart((prev) =>
                      prev
                        ? { ...prev, section: { ...prev.section, rank_label_mode: e.target.value as 'number' | 'month' } }
                        : prev,
                    )
                  }
                >
                  {enumOptions.rank_label_modes.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditingChart(null)} className="px-3 py-2 rounded bg-gray-600 text-white">
                取消
              </button>
              <button onClick={handleSaveSectionConfig} className="px-3 py-2 rounded bg-blue-600 text-white">
                保存
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
