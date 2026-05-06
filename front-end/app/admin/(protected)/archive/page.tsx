'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'

// ── Design Constants ──────────────────────────────────────────────────────────
const FONT = 'var(--font-fredoka)'
const BROWN = 'var(--admin-brown-dark)'
const GOLD = 'var(--admin-gold)'
const CREAM = 'var(--admin-cream)'
const DIVIDER = 'var(--admin-divider)'
const MEDIUM_BROWN = 'var(--admin-brown-medium)'
const GOLD_LIGHT = 'var(--admin-gold-light)'
const GREEN_BRIGHT = 'var(--admin-green-bright)'
const TAN_LIGHT = 'var(--admin-tan-light)'
const CREAM_HOVER = 'var(--admin-cream-hover)'
const CREAM_HOVER_LIGHT = 'var(--admin-cream-hover-light)'
const PAGE_SIZE = 20

interface ArchivedUser {
  auth_user_id: string;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  archived_at: string;
  total_stars: number;
}

function SortIcon({ active, asc }: { active: boolean; asc: boolean }) {
  return (
    <span className="ml-1 inline-block" style={{ color: active ? GOLD : GOLD_LIGHT, fontSize: '0.65rem' }}>
      {active ? (asc ? '▲' : '▼') : '⇅'}
    </span>
  )
}

export default function ArchivedUsersPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [allUsers, setAllUsers] = useState<ArchivedUser[]>([])
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<keyof ArchivedUser>('archived_at')
  const [sortAsc, setSortAsc] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedUser, setSelectedUser] = useState<ArchivedUser | null>(null)

  // 1. Initialize loading as TRUE
  const [loading, setLoading] = useState(true)

  // 2. Modified fetcher: Added 'isInitial' flag to prevent cascading setState
  const fetchArchivedUsers = useCallback(async (isInitial = false) => {
    if (!isInitial) setLoading(true);

    try {
      const { data, error } = await supabase
        .from('archived_profiles')
        .select('*');
      
      if (!error && data) {
        setAllUsers(data);
      }
    } catch (err) {
      console.error("Archive fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // 3. Effect calls with 'true' to signal initial load
  useEffect(() => {
    fetchArchivedUsers(true);
  }, [fetchArchivedUsers]);

  const handleRestore = async (authUserId: string) => {
    if (!confirm("Are you sure you want to retrieve this account?")) return;

    const { error } = await supabase
      .from('profiles')
      .update({ is_archived: false, archived_at: null })
      .eq('auth_user_id', authUserId);

    if (!error) {
      alert('Account retrieved successfully!');
      setSelectedUser(null);
      fetchArchivedUsers();
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allUsers
      .filter(u => !q || u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .sort((a, b) => {
        const av = a[sortKey]; const bv = b[sortKey];
        return sortAsc ? (av > bv ? 1 : -1) : (bv > av ? 1 : -1);
      });
  }, [allUsers, search, sortKey, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 overflow-y-auto lg:overflow-hidden">
      
      <div className="shrink-0 mt-2 sm:mt-3">
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search archived users..."
          className="w-full max-w-[21rem] px-3.5 py-1.5 rounded-lg border-2 bg-white focus:outline-none"
          style={{ fontFamily: FONT, color: BROWN, borderColor: DIVIDER, fontSize: '0.88rem' }}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.44fr)] gap-4 min-h-0 flex-1 items-stretch">
        
        <div className="rounded-2xl overflow-hidden shadow-sm min-h-0 h-full flex flex-col" style={{ backgroundColor: CREAM }}>
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <p style={{ fontFamily: FONT, color: GOLD, fontSize: '1.1rem' }}>Loading archives...</p>
            </div>
          ) : (
            <>
              <div className="grid px-4 sm:px-6 py-2.5 border-b" 
                style={{ gridTemplateColumns: '100px minmax(120px, 1fr) 140px 100px', borderColor: DIVIDER }}>
                <button onClick={() => setSortKey('username')} className="text-left font-semibold" style={{ fontFamily: FONT, color: GOLD, fontSize: '0.82rem' }}>
                  USER <SortIcon active={sortKey==='username'} asc={sortAsc}/>
                </button>
                <span className="font-semibold" style={{ fontFamily: FONT, color: GOLD, fontSize: '0.82rem' }}>EMAIL</span>
                <button onClick={() => setSortKey('archived_at')} className="text-center font-semibold" style={{ fontFamily: FONT, color: GOLD, fontSize: '0.82rem' }}>
                  ARCHIVED DATE <SortIcon active={sortKey==='archived_at'} asc={sortAsc}/>
                </button>
                <span className="text-center font-semibold" style={{ fontFamily: FONT, color: GOLD, fontSize: '0.82rem' }}>PROGRESS</span>
              </div>

              <div className="overflow-y-auto max-h-[68dvh]">
                {paginated.length === 0 ? (
                  <div className="px-6 py-10 text-center"><p style={{ fontFamily: FONT, color: GOLD }}>No archived records found.</p></div>
                ) : (
                  paginated.map((user) => (
                    <div key={user.auth_user_id} onClick={() => setSelectedUser(user)}
                      className="grid px-4 sm:px-6 py-2.5 border-t cursor-pointer transition-colors"
                      style={{ 
                        gridTemplateColumns: '100px minmax(120px, 1fr) 140px 100px', 
                        borderColor: DIVIDER,
                        backgroundColor: selectedUser?.auth_user_id === user.auth_user_id ? CREAM_HOVER : 'transparent' 
                      }}>
                      <span style={{ fontFamily: FONT, color: BROWN, fontSize: '0.82rem' }}>{user.username}</span>
                      <span className="truncate" style={{ fontFamily: FONT, color: BROWN, fontSize: '0.8rem' }}>{user.email}</span>
                      <span className="text-center" style={{ fontFamily: FONT, color: BROWN, fontSize: '0.82rem' }}>{new Date(user.archived_at).toLocaleDateString()}</span>
                      <span className="text-center" style={{ fontFamily: FONT, color: BROWN, fontSize: '0.82rem' }}>⭐ {user.total_stars}</span>
                    </div>
                  ))
                )}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 px-6 py-4 border-t" style={{ borderColor: DIVIDER }}>
                  <button onClick={() => setPage(p => Math.max(1, p-1))} className="px-4 py-1.5 rounded-lg font-semibold" style={{ fontFamily: FONT, color: BROWN, backgroundColor: TAN_LIGHT }}>Prev</button>
                  <span style={{ fontFamily: FONT, color: BROWN }}>{page} / {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p+1))} className="px-4 py-1.5 rounded-lg font-semibold" style={{ fontFamily: FONT, color: BROWN, backgroundColor: TAN_LIGHT }}>Next</button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="min-h-0 h-full text-slate-700">
          {selectedUser ? (
            <div className="rounded-2xl overflow-hidden shadow-sm h-full flex flex-col" style={{ backgroundColor: CREAM }}>
               <div className="px-5 py-2 border-b text-center font-bold" style={{ borderColor: DIVIDER, color: GOLD }}>Archived Details</div>
               <div className="p-8 flex flex-col items-center gap-4">
                  <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-white text-3xl font-bold" style={{ backgroundColor: MEDIUM_BROWN }}>
                    {selectedUser.username[0]?.toUpperCase()}
                  </div>
                  <h3 className="text-center" style={{ fontFamily: FONT, color: BROWN, fontWeight: 'bold' }}>{selectedUser.first_name} {selectedUser.last_name}</h3>
                  
                  <div className="w-full space-y-3 mt-4">
                    <div className="flex justify-between border-b pb-2" style={{ borderColor: DIVIDER }}>
                      <span style={{ fontFamily: FONT, fontSize: '0.75rem', color: GOLD }}>Archived Date</span>
                      <span style={{ fontFamily: FONT, fontSize: '0.75rem', fontWeight: 'bold' }}>{new Date(selectedUser.archived_at).toLocaleDateString()}</span>
                    </div>
                    <div className="flex justify-between border-b pb-2" style={{ borderColor: DIVIDER }}>
                      <span style={{ fontFamily: FONT, fontSize: '0.75rem', color: GOLD }}>Saved Progress</span>
                      <span style={{ fontFamily: FONT, fontSize: '0.75rem', fontWeight: 'bold' }}>{selectedUser.total_stars} Stars</span>
                    </div>
                  </div>

                  <button 
                    onClick={() => handleRestore(selectedUser.auth_user_id)}
                    className="w-full mt-6 py-2.5 rounded-xl font-bold text-white transition-all shadow-md active:scale-95"
                    style={{ backgroundColor: GREEN_BRIGHT, fontFamily: FONT }}
                  >
                    Retrieve Account
                  </button>
               </div>
            </div>
          ) : (
            <div className="rounded-2xl shadow-sm h-full flex items-center justify-center border-2 border-dashed" style={{ backgroundColor: CREAM, borderColor: DIVIDER }}>
              <p style={{ fontFamily: FONT, color: GOLD, fontSize: '0.9rem' }}>Select a user to retrieve</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}