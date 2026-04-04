// ==========================================
// 收藏业务 Hook
// ==========================================
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { getMediaDetails } from '../../api/tmdb';
import { toast } from 'sonner';

interface FavoriteList {
  id: number;
  name: string;
  favorites?: Array<{
    id: number;
    media_id: string;
    media_type: string;
    title: string;
    poster: string;
    year?: string;
    overview?: string;
  }>;
}

interface UseFavoriteOptions {
  mediaId: string;
  mediaType: string;
  title: string;
  poster: string;
  year?: string;
  overview?: string;
  useReactQuery?: boolean;
}

interface UseFavoriteReturn {
  isFavorited: boolean;
  isLoading: boolean;
  showDialog: boolean;
  showAuthModal: boolean;
  lists: FavoriteList[];
  selectedList: number | null;
  note: string;
  sortOrderInput: string;
  showCreateList: boolean;
  newList: { name: string; description: string; is_public: boolean };
  setShowDialog: (show: boolean) => void;
  setShowAuthModal: (show: boolean) => void;
  setSelectedList: (id: number | null) => void;
  setNote: (note: string) => void;
  setSortOrderInput: (value: string) => void;
  setShowCreateList: (show: boolean) => void;
  setNewList: (list: { name: string; description: string; is_public: boolean }) => void;
  handleCreateList: () => Promise<void>;
  handleFavorite: () => Promise<void>;
  handleButtonClick: (e: React.MouseEvent) => void;
  refetch?: () => void;
  isListsLoading: boolean;
  listsLoadError: string | null;
  reloadLists: () => Promise<void>;
}

export function useFavorite({
  mediaId,
  mediaType,
  title,
  poster,
  year,
  overview = '',
  useReactQuery = false
}: UseFavoriteOptions): UseFavoriteReturn {
  const { user } = useAuth();
  const [isFavorited, setIsFavorited] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [selectedList, setSelectedList] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [sortOrderInput, setSortOrderInput] = useState('');
  const [showCreateList, setShowCreateList] = useState(false);
  const [newList, setNewList] = useState({
    name: '',
    description: '',
    is_public: false
  });

  const fetchFavoriteListsWithRetry = async (): Promise<FavoriteList[]> => {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(`/api/favorite-lists/light?_=${Date.now()}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        return Array.isArray(data) ? data : [];
      } catch (error) {
        if (attempt === maxAttempts) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, attempt * 400));
      }
    }
    return [];
  };

  const {
    data: queryLists = [],
    refetch,
    isLoading: isQueryListsLoading,
    isFetching: isQueryListsFetching,
    error: queryListsError
  } = useQuery<FavoriteList[]>({
    queryKey: ['favorite-lists'],
    queryFn: fetchFavoriteListsWithRetry,
    enabled: !!user && useReactQuery,
    staleTime: 1000 * 60 * 5,
    retry: 0,
  });

  const [lists, setLists] = useState<FavoriteList[]>([]);
  const [isManualListsLoading, setIsManualListsLoading] = useState(false);
  const [manualListsError, setManualListsError] = useState<string | null>(null);

  const reloadLists = async () => {
    if (!user) return;

    if (useReactQuery) {
      await refetch();
      return;
    }

    setIsManualListsLoading(true);
    setManualListsError(null);
    try {
      const data = await fetchFavoriteListsWithRetry();
      setLists(data);
      if (data.length > 0) {
        setSelectedList((prev) => prev ?? data[0].id);
      }
    } catch (error) {
      console.error('获取收藏列表失败:', error);
      setManualListsError('收藏列表加载失败，请稍后重试');
    } finally {
      setIsManualListsLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      void reloadLists();
    } else {
      setLists([]);
      setManualListsError(null);
      setIsManualListsLoading(false);
    }
  }, [user, useReactQuery]);

  const currentLists = useReactQuery ? queryLists : lists;
  const isListsLoading = useReactQuery ? (isQueryListsLoading || isQueryListsFetching) : isManualListsLoading;
  const listsLoadError = useReactQuery
    ? (queryListsError ? '收藏列表加载失败，请稍后重试' : null)
    : manualListsError;

  useEffect(() => {
    if (currentLists.length > 0 && !selectedList) {
      setSelectedList(currentLists[0].id);
    }
  }, [currentLists, selectedList]);

  useEffect(() => {
    if (!user || currentLists.length === 0) {
      setIsFavorited(false);
      return;
    }
    
    const isInAnyList = currentLists.some(list => 
      list.favorites?.some(
        fav => fav.media_id === mediaId && fav.media_type === mediaType
      )
    );
    
    setIsFavorited(isInAnyList);
  }, [user, currentLists, mediaId, mediaType]);

  const handleCreateList = async () => {
    try {
      const response = await fetch('/api/favorite-lists', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(newList)
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.detail || '创建收藏列表失败');
      }

      const data = await response.json();
      if (useReactQuery) {
        setSelectedList(data.id);
        setShowCreateList(false);
        setNewList({ name: '', description: '', is_public: false });
        await reloadLists();
      } else {
        setLists([...lists, data]);
        setSelectedList(data.id);
        setShowCreateList(false);
        setNewList({ name: '', description: '', is_public: false });
      }
      toast.success('收藏列表创建成功');
    } catch (error) {
      console.error('创建收藏列表失败:', error);
      toast.error(error instanceof Error ? error.message : '创建收藏列表失败');
    }
  };

  const handleFavorite = async () => {
    if (!user || !selectedList) return;
    
    setIsLoading(true);
    try {
      let finalTitle = title;
      let finalPoster = poster;
      let finalYear = year;
      let finalOverview = overview;
      
      if ((!year || !overview) && useReactQuery) {
        try {
          const details = await getMediaDetails(mediaType, mediaId);
          finalTitle = details.title || title;
          finalPoster = poster || details.poster;
          finalYear = details.year || year || '';
          finalOverview = details.overview || overview || '';
        } catch (error) {
          console.error('获取影视详情失败，使用已有信息:', error);
        }
      }
      
      const response = await fetch('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          media_id: mediaId,
          media_type: mediaType,
          title: finalTitle,
          year: finalYear || '',
          poster: finalPoster,
          overview: finalOverview || '',
          list_id: selectedList,
          note,
          sort_order: sortOrderInput.trim()
            ? Math.max(0, Number(sortOrderInput) - 1 || 0)
            : undefined
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.detail || '保存收藏失败');
      }

      setIsFavorited(true);
      setShowDialog(false);
      setNote('');
      setSortOrderInput('');
      if (useReactQuery) {
        await reloadLists();
      }
      toast.success('收藏保存成功');
    } catch (error) {
      console.error('收藏操作失败:', error);
      toast.error(error instanceof Error ? error.message : '保存收藏失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleButtonClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!user && useReactQuery) {
      setShowAuthModal(true);
      return;
    }
    
    setShowDialog(true);
  };

  return {
    isFavorited,
    isLoading,
    showDialog,
    showAuthModal,
    lists: currentLists,
    selectedList,
    note,
    sortOrderInput,
    showCreateList,
    newList,
    setShowDialog,
    setShowAuthModal,
    setSelectedList,
    setNote,
    setSortOrderInput,
    setShowCreateList,
    setNewList,
    handleCreateList,
    handleFavorite,
    handleButtonClick,
    refetch: useReactQuery ? (() => { void refetch(); }) : undefined,
    isListsLoading,
    listsLoadError,
    reloadLists,
  };
}
