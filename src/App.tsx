import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 20
const FILTER_DELTAS = [0, 50, 100, 150, 200, 250, 300] as const
const ACTIVITY_DAYS = 180
const ACTIVITY_MIN_START = '2025-01-01'

type TabKey = 'contest' | 'fundamentals'

type ContestProblem = {
  id: number
  title: string
  title_slug: string
  rating: number
  solved: number
}

type FundamentalsProblem = {
  id: number
  leetcode_question_link: string
  neetcode_question_link: string
  difficulty: string
  tag: string
  solved: number
}

type ProblemsResponse = {
  tab: TabKey
  page: number
  pageSize: number
  total: number
  solved: number
  rows: ContestProblem[] | FundamentalsProblem[]
}

type RatingResponse = {
  rating: number | null
}

type SolvedUpdateResponse = {
  ok: boolean
  id: number
  solved: number
}

type HistogramBucket = {
  start: number
  end: number
  total: number
  solved: number
}

type ContestHistogramResponse = {
  buckets: HistogramBucket[]
}

type ActivityEntry = {
  utc_date: string
  count: number
}

type ActivityResponse = {
  days: number
  startDate: string
  endDate: string
  activity: ActivityEntry[]
}

type SortBy = 'problem' | 'rating' | 'solved'
type SortDir = 'asc' | 'desc'
type ContestFilter = 'all' | (typeof FILTER_DELTAS)[number]

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedFilter, setSelectedFilter] = useState<ContestFilter>('all')
  const [sortBy, setSortBy] = useState<SortBy>('rating')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [ratingFilterHint, setRatingFilterHint] = useState<string | null>(null)
  const [problems, setProblems] = useState<ProblemsResponse | null>(null)
  const [isLoadingProblems, setIsLoadingProblems] = useState(false)
  const [problemsError, setProblemsError] = useState<string | null>(null)
  const [lcRating, setLcRating] = useState<number | null>(null)
  const [ratingDraft, setRatingDraft] = useState('')
  const [isEditingRating, setIsEditingRating] = useState(false)
  const [isSavingRating, setIsSavingRating] = useState(false)
  const [ratingError, setRatingError] = useState<string | null>(null)
  const [highlightSignInMessage, setHighlightSignInMessage] = useState(false)
  const [pendingSolvedId, setPendingSolvedId] = useState<number | null>(null)
  const [histogram, setHistogram] = useState<HistogramBucket[]>([])
  const [isLoadingHistogram, setIsLoadingHistogram] = useState(false)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [isLoadingActivity, setIsLoadingActivity] = useState(false)
  const [activityEndDate, setActivityEndDate] = useState(() => {
    const now = new Date()
    now.setUTCHours(0, 0, 0, 0)
    return now.toISOString().slice(0, 10)
  })
  const [activityWindow, setActivityWindow] = useState<{ startDate: string; endDate: string } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pathname = window.location.pathname
  const isLeetcodePage = pathname === '/leetcode'
  const { data, isPending } = authClient.useSession()
  const userEmail = data?.user?.email ?? null

  useEffect(() => {
    const root = document.documentElement
    const stored = window.localStorage.getItem('theme')
    const initialTheme: 'light' | 'dark' =
      stored === 'dark' || stored === 'light' ? stored : 'dark'
    setTheme(initialTheme)
    root.classList.toggle('dark', initialTheme === 'dark')
  }, [])

  const toggleTheme = () => {
    const nextTheme: 'light' | 'dark' = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    document.documentElement.classList.toggle('dark', nextTheme === 'dark')
    window.localStorage.setItem('theme', nextTheme)
  }

  const handleSocialSignIn = async (provider: 'google' | 'github') => {
    setIsSigningIn(true)
    setSignInOpen(false)
    try {
      await authClient.signIn.social({
        provider,
        callbackURL: '/',
      })
    } finally {
      setIsSigningIn(false)
    }
  }

  const handleSignOut = async () => {
    setIsSigningOut(true)
    try {
      await authClient.signOut()
    } finally {
      setIsSigningOut(false)
    }
  }

  useEffect(() => {
    if (!signInOpen) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setSignInOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [signInOpen])

  useEffect(() => {
    if (!ratingFilterHint) return
    const timer = window.setTimeout(() => {
      setRatingFilterHint(null)
    }, 1600)
    return () => window.clearTimeout(timer)
  }, [ratingFilterHint])

  useEffect(() => {
    if (!highlightSignInMessage) return
    const timer = window.setTimeout(() => {
      setHighlightSignInMessage(false)
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [highlightSignInMessage])

  useEffect(() => {
    if (!isLeetcodePage) return
    const ac = new AbortController()

    const loadProblems = async () => {
      const maxRating =
        selectedFilter === 'all' || lcRating == null ? null : lcRating + selectedFilter
      const isAllFilter = selectedFilter === 'all'
      const query = new URLSearchParams({
        tab: 'contest',
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (isAllFilter) {
        query.set('sortBy', sortBy)
        query.set('sortDir', sortDir)
      }
      if (maxRating != null) {
        query.set('maxRating', String(maxRating))
      }

      setIsLoadingProblems(true)
      setProblemsError(null)
      try {
        const res = await fetch(`/api/leetcode/problems?${query.toString()}`, {
          signal: ac.signal,
        })
        if (!res.ok) {
          throw new Error(`Request failed with ${res.status}`)
        }
        const json = (await res.json()) as ProblemsResponse
        setProblems(json)
      } catch (err) {
        if (ac.signal.aborted) return
        setProblemsError(err instanceof Error ? err.message : 'Failed to load problems')
      } finally {
        if (!ac.signal.aborted) setIsLoadingProblems(false)
      }
    }

    void loadProblems()
    return () => ac.abort()
  }, [isLeetcodePage, userEmail, page, lcRating, selectedFilter, sortBy, sortDir])

  useEffect(() => {
    if (!isLeetcodePage) return
    if (!userEmail) {
      setLcRating(0)
      setRatingDraft('0')
      setRatingError(null)
      setIsEditingRating(false)
      return
    }
    const ac = new AbortController()

    const loadRating = async () => {
      setRatingError(null)
      try {
        const res = await fetch('/api/leetcode/rating', { signal: ac.signal })
        if (!res.ok) {
          throw new Error(`Request failed with ${res.status}`)
        }
        const json = (await res.json()) as RatingResponse
        setLcRating(json.rating)
        setRatingDraft(json.rating == null ? '' : String(json.rating))
        if (json.rating === 0) {
          setSelectedFilter('all')
        }
      } catch (err) {
        if (ac.signal.aborted) return
        setRatingError(err instanceof Error ? err.message : 'Failed to load rating')
      }
    }

    void loadRating()
    return () => ac.abort()
  }, [isLeetcodePage, userEmail])

  useEffect(() => {
    if (!isLeetcodePage || !userEmail) {
      setActivity([])
      setActivityWindow(null)
      return
    }
    const ac = new AbortController()

    const loadActivity = async () => {
      setIsLoadingActivity(true)
      try {
        const res = await fetch(
          `/api/leetcode/activity?days=${ACTIVITY_DAYS}&endDate=${encodeURIComponent(activityEndDate)}`,
          { signal: ac.signal },
        )
        if (!res.ok) {
          throw new Error(`Request failed with ${res.status}`)
        }
        const json = (await res.json()) as ActivityResponse
        setActivity(json.activity ?? [])
        setActivityWindow({
          startDate: json.startDate,
          endDate: json.endDate,
        })
      } catch {
        if (!ac.signal.aborted) {
          setActivity([])
          setActivityWindow(null)
        }
      } finally {
        if (!ac.signal.aborted) {
          setIsLoadingActivity(false)
        }
      }
    }

    void loadActivity()
    return () => ac.abort()
  }, [isLeetcodePage, userEmail, activityEndDate])

  useEffect(() => {
    if (!isLeetcodePage) return
    const ac = new AbortController()

    const loadHistogram = async () => {
      setIsLoadingHistogram(true)
      try {
        const res = await fetch('/api/leetcode/contest/histogram', { signal: ac.signal })
        if (!res.ok) {
          throw new Error(`Request failed with ${res.status}`)
        }
        const json = (await res.json()) as ContestHistogramResponse
        setHistogram(json.buckets ?? [])
      } catch {
        if (!ac.signal.aborted) {
          setHistogram([])
        }
      } finally {
        if (!ac.signal.aborted) {
          setIsLoadingHistogram(false)
        }
      }
    }

    void loadHistogram()
    return () => ac.abort()
  }, [isLeetcodePage, userEmail])

  const handleSetRating = async () => {
    if (!userEmail) {
      setRatingError('Sign in to set your rating')
      return
    }
    const parsed = Number(ratingDraft)
    if (!Number.isFinite(parsed)) {
      setRatingError('Please enter a valid number')
      return
    }

    setIsSavingRating(true)
    setRatingError(null)
    try {
      const res = await fetch('/api/leetcode/rating', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ rating: parsed }),
      })
      if (!res.ok) {
        throw new Error(`Request failed with ${res.status}`)
      }
      const json = (await res.json()) as RatingResponse
      setLcRating(json.rating)
      setRatingDraft(json.rating == null ? '' : String(json.rating))
      setSelectedFilter('all')
      setPage(1)
      setIsEditingRating(false)
    } catch (err) {
      setRatingError(err instanceof Error ? err.message : 'Failed to save rating')
    } finally {
      setIsSavingRating(false)
    }
  }

  const handleEditRating = () => {
    if (!userEmail) {
      setHighlightSignInMessage(true)
      return
    }
    setRatingError(null)
    setRatingDraft(lcRating == null ? '' : String(lcRating))
    setIsEditingRating(true)
  }

  const handleCancelEditRating = () => {
    setRatingError(null)
    setRatingDraft(lcRating == null ? '' : String(lcRating))
    setIsEditingRating(false)
  }

  const totalPages = problems ? Math.max(1, Math.ceil(problems.total / problems.pageSize)) : 1
  const isAllFilter = selectedFilter === 'all'

  const handleSort = (column: SortBy) => {
    if (!isAllFilter) return
    setPage(1)
    if (sortBy === column) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortBy(column)
    setSortDir('asc')
  }

  const sortIndicator = (column: SortBy) => {
    if (!isAllFilter) return ''
    if (sortBy !== column) return ''
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  const filterToneClass = (delta: (typeof FILTER_DELTAS)[number]) => {
    if (delta <= 100) {
      return 'bg-emerald-100/70 border-emerald-300 text-emerald-900 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-200'
    }
    if (delta <= 200) {
      return 'bg-orange-100/70 border-orange-300 text-orange-900 dark:bg-orange-900/30 dark:border-orange-700 dark:text-orange-200'
    }
    return 'bg-red-100/70 border-red-300 text-red-900 dark:bg-red-900/30 dark:border-red-700 dark:text-red-200'
  }

  const refreshHistogram = async () => {
    try {
      const res = await fetch('/api/leetcode/contest/histogram')
      if (!res.ok) return
      const json = (await res.json()) as ContestHistogramResponse
      setHistogram(json.buckets ?? [])
    } catch {
      // no-op: table update already succeeded
    }
  }

  const refreshActivity = async () => {
    if (!userEmail) return
    try {
      const res = await fetch(
        `/api/leetcode/activity?days=${ACTIVITY_DAYS}&endDate=${encodeURIComponent(activityEndDate)}`,
      )
      if (!res.ok) return
      const json = (await res.json()) as ActivityResponse
      setActivity(json.activity ?? [])
      setActivityWindow({
        startDate: json.startDate,
        endDate: json.endDate,
      })
    } catch {
      // no-op: table update already succeeded
    }
  }

  const setSolved = async (id: number, solved: 0 | 1) => {
    if (!userEmail) {
      setProblemsError('Sign in to track solved count')
      return
    }
    setPendingSolvedId(id)
    try {
      const res = await fetch('/api/leetcode/contest/solved/set', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ id, solved }),
      })
      if (!res.ok) {
        throw new Error(`Request failed with ${res.status}`)
      }
      const json = (await res.json()) as SolvedUpdateResponse
      setProblems((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          rows: (prev.rows as ContestProblem[]).map((row) =>
            row.id === json.id ? { ...row, solved: json.solved } : row,
          ),
        }
      })
      void refreshHistogram()
      if (solved === 1) {
        void refreshActivity()
      }
    } catch {
      setProblemsError('Failed to update solved count')
    } finally {
      setPendingSolvedId(null)
    }
  }

  const parseDate = (date: string) => new Date(`${date}T00:00:00.000Z`)
  const formatDate = (date: Date) => date.toISOString().slice(0, 10)
  const addDays = (date: string, days: number) => {
    const d = parseDate(date)
    d.setUTCDate(d.getUTCDate() + days)
    return formatDate(d)
  }

  const todayUtc = (() => {
    const d = new Date()
    d.setUTCHours(0, 0, 0, 0)
    return formatDate(d)
  })()
  const earliestEnd = addDays(ACTIVITY_MIN_START, ACTIVITY_DAYS - 1)
  const canBack = activityWindow
    ? activityWindow.startDate > ACTIVITY_MIN_START
    : parseDate(addDays(activityEndDate, -(ACTIVITY_DAYS - 1))) > parseDate(ACTIVITY_MIN_START)
  const canForward = activityWindow
    ? activityWindow.endDate < todayUtc
    : activityEndDate < todayUtc

  const goBackActivity = () => {
    const candidate = addDays(activityEndDate, -ACTIVITY_DAYS)
    const bounded = parseDate(candidate) < parseDate(earliestEnd) ? earliestEnd : candidate
    setActivityEndDate(bounded)
  }

  const goForwardActivity = () => {
    const candidate = addDays(activityEndDate, ACTIVITY_DAYS)
    const bounded = parseDate(candidate) > parseDate(todayUtc) ? todayUtc : candidate
    setActivityEndDate(bounded)
  }

  const renderLeetcodePage = () => (
    <main className='mx-auto w-full max-w-6xl px-4 py-8'>
      <div className='mb-6 border p-5 bg-background'>
        <div className='mb-2 flex items-center gap-2 text-xs tracking-wide'>
          <p className='text-muted-foreground'>LEETCODE</p>
          {!userEmail && (
            <p
              className={cn(
                'text-destructive',
                highlightSignInMessage ? 'underline underline-offset-2' : '',
              )}
            >
              Please sign in to set rating and save progress
            </p>
          )}
        </div>
        {!isEditingRating && (
          <div className='flex items-center gap-2 text-sm'>
            <p>Rating: {lcRating == null || lcRating === 0 ? 'Not set' : lcRating}</p>
            <button
              type='button'
              onClick={handleEditRating}
              className='text-xs underline text-muted-foreground hover:text-foreground'
              title={userEmail ? 'Edit rating' : 'Sign in to set your rating'}
            >
              Edit
            </button>
            {lcRating === 0 && userEmail && (
              <p className='text-xs text-muted-foreground'>
                | Set your rating to enable filters
              </p>
            )}
          </div>
        )}
        {isEditingRating && (
          <div className='flex flex-wrap items-end gap-2'>
            <label className='text-sm'>
              <span className='mb-1 block text-xs text-muted-foreground'>Rating</span>
              <input
                type='number'
                value={ratingDraft}
                onChange={(e) => setRatingDraft(e.target.value)}
                className='h-9 w-40 border bg-background px-2 text-sm'
                placeholder='Enter rating'
              />
            </label>
            <Button
              onClick={handleSetRating}
              disabled={isSavingRating}
            >
              {isSavingRating ? 'Saving...' : 'Save'}
            </Button>
            <Button
              variant='outline'
              onClick={handleCancelEditRating}
              disabled={isSavingRating}
            >
              Cancel
            </Button>
          </div>
        )}
        {ratingError && <p className='mt-2 text-sm text-destructive'>{ratingError}</p>}
      </div>

      <div className='mb-6 grid gap-4 md:grid-cols-2'>
          <div className='min-w-0 border p-4 bg-background'>
            <div className='mb-3 flex items-center justify-between gap-3'>
              <p className='text-xs text-muted-foreground'>Rating Distribution (1001-4000)</p>
              <div className='flex items-center gap-3 text-[11px] text-muted-foreground'>
                <span className='inline-flex items-center gap-1'>
                  <span className='h-2 w-2 bg-zinc-400' />
                  Total
                </span>
                <span className='inline-flex items-center gap-1'>
                  <span className='h-2 w-2 bg-emerald-600' />
                  Solved
                </span>
              </div>
            </div>
            {isLoadingHistogram ? (
              <p className='text-xs text-muted-foreground'>Loading chart...</p>
            ) : (
              <div className='overflow-x-auto border p-3'>
                <div className='flex min-w-[1100px] items-end gap-2'>
                  {(() => {
                    const maxTotal = Math.max(1, ...histogram.map((b) => b.total))
                    return histogram.map((bucket) => {
                      const totalHeight = Math.max(
                        2,
                        Math.round((bucket.total / maxTotal) * 128),
                      )
                      const solvedHeight =
                        bucket.total === 0 || bucket.solved === 0
                          ? 0
                          : Math.max(2, Math.round((bucket.solved / maxTotal) * 128))
                      return (
                        <div
                          key={`${bucket.start}-${bucket.end}`}
                          className='flex w-8 flex-col items-center'
                        >
                          <div
                            className='group relative h-32 w-full rounded-sm bg-muted/25'
                          >
                            <div className='pointer-events-none absolute left-1/2 top-1 z-20 hidden -translate-x-1/2 whitespace-nowrap rounded border bg-background px-2 py-1 text-[10px] shadow group-hover:block'>
                              {bucket.start}-{bucket.end}: {bucket.solved}/{bucket.total}
                            </div>
                            <div
                              className='absolute bottom-0 left-0 right-0 rounded-t-sm bg-zinc-400'
                              style={{ height: `${totalHeight}px` }}
                            />
                            <div
                              className='absolute bottom-0 left-1 right-1 rounded-t-sm bg-emerald-600'
                              style={{ height: `${solvedHeight}px` }}
                            />
                          </div>
                          <p className='mt-1 text-[10px] leading-none text-muted-foreground'>
                            {bucket.end}
                          </p>
                        </div>
                      )
                    })
                  })()}
                </div>
              </div>
            )}
          </div>

          <div className='min-w-0 border p-4 bg-background flex flex-col'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <p className='text-xs text-muted-foreground'>Activity (Last {ACTIVITY_DAYS} Days, UTC)</p>
              <div className='flex items-center gap-2'>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  className='h-7 px-2'
                  onClick={goBackActivity}
                  disabled={!userEmail || !canBack || isLoadingActivity}
                  title={userEmail ? 'Previous 180 days' : 'Sign in to view activity'}
                >
                  &lt;
                </Button>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  className='h-7 px-2'
                  onClick={goForwardActivity}
                  disabled={!userEmail || !canForward || isLoadingActivity}
                  title={userEmail ? 'Next 180 days' : 'Sign in to view activity'}
                >
                  &gt;
                </Button>
              </div>
            </div>
            {!userEmail ? (
              <div className='flex flex-1 items-center justify-center border p-3'>
                <p className='text-xs text-muted-foreground'>Sign in to view your activity heatmap</p>
              </div>
            ) : isLoadingActivity ? (
              <p className='text-xs text-muted-foreground'>Loading activity...</p>
            ) : (
              <div className='flex flex-1 items-center'>
                <div className='w-full overflow-x-auto border p-3'>
                {(() => {
                  const activityMap = new Map(activity.map((entry) => [entry.utc_date, entry.count]))
                  const end = activityWindow ? parseDate(activityWindow.endDate) : parseDate(todayUtc)
                  const start = activityWindow
                    ? parseDate(activityWindow.startDate)
                    : parseDate(addDays(todayUtc, -(ACTIVITY_DAYS - 1)))
                  const gridStart = new Date(start)
                  gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay())
                  const gridEnd = new Date(end)
                  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - gridEnd.getUTCDay()))

                  const cells: Array<{ key: string; date: string; inRange: boolean; count: number }> = []
                  const cursor = new Date(gridStart)
                  while (cursor <= gridEnd) {
                    const date = cursor.toISOString().slice(0, 10)
                    cells.push({
                      key: date,
                      date,
                      inRange: cursor >= start && cursor <= end,
                      count: activityMap.get(date) ?? 0,
                    })
                    cursor.setUTCDate(cursor.getUTCDate() + 1)
                  }

                  const weeks: typeof cells[] = []
                  for (let i = 0; i < cells.length; i += 7) {
                    weeks.push(cells.slice(i, i + 7))
                  }

                  const colorForCount = (count: number): string => {
                    if (count <= 0) return 'bg-zinc-300'
                    if (count === 1) return 'bg-green-100'
                    if (count === 2) return 'bg-green-200'
                    if (count === 3) return 'bg-green-300'
                    if (count === 4) return 'bg-green-500'
                    if (count === 5) return 'bg-green-700'
                    return 'bg-green-900'
                  }

                  return (
                    <div className='mx-auto w-fit space-y-2'>
                      <div className='mx-auto flex w-fit gap-1'>
                        {weeks.map((week, weekIndex) => (
                          <div key={`week-${weekIndex}`} className='flex flex-col gap-1'>
                            {week.map((cell) => (
                              <div
                                key={cell.key}
                                className={cn(
                                  'group relative h-3 w-3 rounded-[2px]',
                                  cell.inRange ? colorForCount(cell.count) : 'bg-transparent',
                                )}
                              >
                                {cell.inRange && (
                                  <div className='pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded border bg-background px-2 py-1 text-[10px] shadow group-hover:block'>
                                    {cell.date}: {cell.count}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                      <div className='flex items-center justify-center gap-2 text-[11px] text-muted-foreground'>
                        <span>0</span>
                        <span className='h-2 w-2 bg-zinc-300' />
                        <span className='h-2 w-2 bg-green-100' />
                        <span className='h-2 w-2 bg-green-200' />
                        <span className='h-2 w-2 bg-green-300' />
                        <span className='h-2 w-2 bg-green-500' />
                        <span className='h-2 w-2 bg-green-700' />
                        <span className='h-2 w-2 bg-green-900' />
                        <span>6+</span>
                      </div>
                    </div>
                  )
                })()}
                </div>
              </div>
            )}
          </div>
      </div>

      <div className='mb-4 flex flex-wrap items-center gap-2'>
        <Button
          type='button'
          size='sm'
          variant={selectedFilter === 'all' ? 'default' : 'outline'}
          onClick={() => {
            setSelectedFilter('all')
            setPage(1)
          }}
        >
          All
        </Button>
        <span className='text-muted-foreground'>|</span>
        <span className='text-sm text-muted-foreground'>Rating:</span>
        {FILTER_DELTAS.map((delta) => {
          const isBlocked = !userEmail || lcRating === 0 || lcRating == null
          const isActive = selectedFilter === delta
          return (
            <Button
              key={delta}
              type='button'
              size='sm'
              variant={isActive ? 'default' : 'outline'}
              className={cn(!isActive ? filterToneClass(delta) : '')}
              onClick={() => {
                if (isBlocked) {
                  setRatingFilterHint('Please sign in and set your base rating')
                  return
                }
                setRatingFilterHint(null)
                setSelectedFilter(delta)
                setPage(1)
              }}
            >
              {delta === 0 ? 'Base' : `+${delta}`}
            </Button>
          )
        })}
        {ratingFilterHint && (
          <p className='text-xs text-muted-foreground'>{ratingFilterHint}</p>
        )}
      </div>

      <section className='border p-4 bg-background'>
        {problemsError && <p className='text-sm text-destructive'>{problemsError}</p>}
        {isLoadingProblems && <p className='text-sm text-muted-foreground'>Loading problems...</p>}

        {!isLoadingProblems && problems && (
          <div className='overflow-x-auto'>
            <table className='w-full border-collapse text-sm'>
              <thead>
                <tr className='border-b text-left'>
                  <th className='p-2 font-medium text-left'>
                    {isAllFilter ? (
                      <button
                        type='button'
                        onClick={() => handleSort('problem')}
                        className='hover:underline'
                      >
                        Problem{sortIndicator('problem')}
                      </button>
                    ) : (
                      <span>Problem</span>
                    )}
                  </th>
                  <th className='p-2 font-medium text-center'>
                    {isAllFilter ? (
                      <button
                        type='button'
                        onClick={() => handleSort('rating')}
                        className='hover:underline'
                      >
                        Rating{sortIndicator('rating')}
                      </button>
                    ) : (
                      <span>Rating</span>
                    )}
                  </th>
                  <th className='p-2 font-medium text-center'>
                    {isAllFilter ? (
                      <button
                        type='button'
                        onClick={() => handleSort('solved')}
                        className='hover:underline'
                      >
                        Solved{sortIndicator('solved')}
                      </button>
                    ) : (
                      <span>Solved</span>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(problems.rows as ContestProblem[]).map((problem) => (
                  <tr
                    key={problem.id}
                    className={cn(
                      'border-b',
                      problem.solved > 0 ? 'bg-emerald-50/60 dark:bg-emerald-900/25' : '',
                    )}
                  >
                    <td className='p-2'>
                      <a
                        href={`https://leetcode.com/problems/${problem.title_slug}/`}
                        target='_blank'
                        rel='noreferrer'
                        className='hover:underline'
                      >
                        {problem.id}. {problem.title}
                      </a>
                    </td>
                    <td className='p-2 text-center'>{Math.round(problem.rating)}</td>
                    <td
                      className={cn(
                        'p-2 text-center',
                        problem.solved > 0
                          ? 'text-emerald-700 font-medium'
                          : 'text-muted-foreground',
                      )}
                    >
                      <div className='flex items-center justify-center'>
                        <input
                          type='checkbox'
                          checked={problem.solved > 0}
                          onChange={(e) => setSolved(problem.id, e.target.checked ? 1 : 0)}
                          disabled={!userEmail || pendingSolvedId === problem.id}
                          className='h-4 w-4'
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className='mt-6 flex items-center gap-2'>
        <Button
          variant='outline'
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1 || isLoadingProblems}
        >
          Previous
        </Button>
        <p className='text-sm text-muted-foreground'>
          Page {page} of {totalPages}
        </p>
        <Button
          variant='outline'
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages || isLoadingProblems}
        >
          Next
        </Button>
      </div>
    </main>
  )

  const renderHomePage = () => (
    <main className='mx-auto w-full max-w-6xl px-4 py-10'>
      <section className='border bg-background p-8 md:p-10'>
        <p className='text-xs tracking-wide text-muted-foreground'>DSA GYM</p>
        <h1 className='mt-2 text-3xl font-semibold leading-tight md:text-4xl'>
          Train for LeetCode contests like strength training.
        </h1>
        <p className='mt-4 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base'>
          Reps x Sets x Progressive Overload
        </p>
        <div className='mt-6 flex flex-wrap gap-2'>
          <a href='/leetcode'>
            <Button>Start training</Button>
          </a>
        </div>
      </section>

      <section className='mt-6 border bg-background p-6 md:p-8'>
        <h2 className='text-lg font-semibold'>The Training Model</h2>
        <div className='mt-4 grid gap-3 md:grid-cols-3'>
          <div className='border p-4'>
            <p className='text-sm font-medium'>Set your base rating</p>
            <p className='mt-2 text-xs text-muted-foreground'>
              Use your current contest rating as the baseline for training.
            </p>
          </div>
          <div className='border p-4'>
            <p className='text-sm font-medium'>Practice above your base</p>
            <p className='mt-2 text-xs text-muted-foreground'>
              Solve problems slightly higher than your base to create progressive overload.
            </p>
          </div>
          <div className='border p-4'>
            <p className='text-sm font-medium'>Update weekly and repeat</p>
            <p className='mt-2 text-xs text-muted-foreground'>
              Attend contests regularly, recalculate your base rating, and continue the cycle.
            </p>
          </div>
        </div>
      </section>

      <section className='mt-6 border bg-background p-6 md:p-8'>
        <h2 className='text-lg font-semibold'>FAQ</h2>
        <div className='mt-4 space-y-3'>
          <div className='border p-4'>
            <p className='text-sm font-medium'>Q: What is the motivation behind this website?</p>
            <p className='mt-2 text-sm text-muted-foreground'>
              A: Leetcode difficulty tags are inconsistent. Some mediums are more difficult than hards, and vice versa. Numeric ratings are much more useful for structured practice, but Leetcode does not expose them directly.
            </p>
            <p className='mt-2 text-sm text-muted-foreground'>
              Tools like{' '}
              <a
                href='https://chromewebstore.google.com/detail/leetcode-difficulty-ratin/hedijgjklbddpidomdhhngflipnibhca'
                target='_blank'
                rel='noreferrer'
                className='underline'
              >
                this Chrome extension
              </a>{' '}
              and{' '}
              <a
                href='https://zerotrac.github.io/leetcode_problem_rating/#/'
                target='_blank'
                rel='noreferrer'
                className='underline'
              >
                Zerotrac
              </a>{' '}
              help surface ratings. I used to maintain this workflow in an Excel sheet by manually adjusting my base rating and selecting problems around it.
            </p>
            <p className='mt-2 text-sm text-muted-foreground'>
              This website is my attempt to make that process easier to repeat. Also, shoutout to the Zerotrac developer. This backend uses Zerotrac data to keep the Leetcode problem list updated.
            </p>
          </div>
          <div className='border p-4'>
            <p className='text-sm font-medium'>Q: Should I use this as a beginner?</p>
            <p className='mt-2 text-sm text-muted-foreground'>
              A: Mostly, no. First, build your fundamentals with Neetcode 150 and other core DSA resources.
            </p>
            <p className='mt-2 text-sm text-muted-foreground'>
              That said, do not stay in fundamentals forever. Once you are comfortable with most common data structures and algorithms, this rating-based practice style can help you build faster problem recognition and stronger contest intuition.
            </p>
          </div>
          <div className='border p-4'>
            <p className='text-sm font-medium'>Q: Why are there no tags on the questions?</p>
            <p className='mt-2 text-sm text-muted-foreground'>
              A: This is partly deliberate and partly due to limited direct access to Leetcode problem metadata. The deliberate part is important: heavy tag dependence can reduce your ability to identify patterns on your own during contests.
            </p>
            <p className='mt-2 text-sm text-muted-foreground'>
              The goal here is to train intuition first, then use analysis after solving.
            </p>
          </div>
          <div className='border p-4'>
            <p className='text-sm font-medium'>Q: What if I'm stuck at a problem?</p>
            <p className='mt-2 text-sm text-muted-foreground'>
              A: Watch the David Goggins of Leetcode:{' '}
              <a
                href='https://www.youtube.com/@Algorithmist'
                target='_blank'
                rel='noreferrer'
                className='underline'
              >
                @Algorithmist
              </a>. I'm 100% certain he has already covered that problem.
            </p>
            <p className='mt-2 text-sm text-muted-foreground'>
              Shoutout to Larry! There's no one like him.
            </p>
          </div>
        </div>
      </section>
    </main>
  )

  return (
    <div className='min-h-screen bg-background'>
      <nav className='border-b bg-background'>
        <div className='mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4'>
          <div className='flex items-center gap-6'>
            <a
              href='/'
              className='text-sm font-semibold tracking-wide text-foreground hover:text-foreground/80'
            >
              DSA Gym
            </a>
            <a
              href='/leetcode'
              className='text-sm font-medium text-foreground/80 hover:text-foreground'
            >
              Leetcode
            </a>
          </div>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={toggleTheme}
            >
              {theme === 'dark' ? 'Light' : 'Dark'}
            </Button>
            {data?.user ? (
              <Button
                onClick={handleSignOut}
                disabled={isSigningOut}
              >
                {isSigningOut ? 'Signing out...' : 'Sign out'}
              </Button>
            ) : (
              <div className='relative' ref={menuRef}>
                <Button
                  onClick={() => setSignInOpen((o) => !o)}
                  disabled={isSigningIn || isPending}
                >
                  {isSigningIn ? 'Redirecting...' : 'Sign in'}
                </Button>
                {signInOpen && (
                  <div className='absolute right-0 top-full z-10 mt-1 flex min-w-[10rem] flex-col gap-0.5 rounded-md border bg-background p-1 shadow'>
                    <Button
                      variant='outline'
                      size='sm'
                      className='justify-start'
                      onClick={() => handleSocialSignIn('google')}
                    >
                      Google
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      className='justify-start'
                      onClick={() => handleSocialSignIn('github')}
                    >
                      GitHub
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </nav>
      {isLeetcodePage && renderLeetcodePage()}
      {!isLeetcodePage && renderHomePage()}
    </div>
  )
}

export default App
