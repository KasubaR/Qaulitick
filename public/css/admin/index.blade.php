@extends('admin.layouts.app')

@section('title', 'Dashboard')
@section('page-title', 'Dashboard')

@section('content')

{{-- ── Alert Strip ─────────────────────────────────────────── --}}
@if($alerts->isNotEmpty())
<div class="alerts-strip animate-in">
  @foreach($alerts as $alert)
    <div class="alert-chip {{ $alert['type'] }}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        @if($alert['type'] === 'info')
          <circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/>
        @elseif($alert['type'] === 'warn')
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        @else
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        @endif
      </svg>
      {{ $alert['message'] }}
    </div>
  @endforeach
</div>
@endif

{{-- ── Stat Cards ──────────────────────────────────────────── --}}
<div class="stats-grid">

  <div class="stat-card animate-in delay-1">
    <div class="stat-icon green">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
    </div>
    <div class="stat-value" data-count="{{ $stats['total_enrollments'] }}">0</div>
    <div class="stat-label">Total Enrollments</div>
    <div class="stat-change up">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px">
        <polyline points="18 15 12 9 6 15"/>
      </svg>
      +{{ $stats['enrollments_today'] }} today
    </div>
  </div>

  <div class="stat-card animate-in delay-2">
    <div class="stat-icon orange">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
      </svg>
    </div>
    <div class="stat-value" data-count="{{ $stats['pending'] }}">0</div>
    <div class="stat-label">Pending Review</div>
    <div class="stat-change up" style="color:var(--warn)">
      Awaiting decision
    </div>
  </div>

  <div class="stat-card animate-in delay-3">
    <div class="stat-icon green">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    </div>
    <div class="stat-value" data-count="{{ $stats['approved'] }}">0</div>
    <div class="stat-label">Approved</div>
    <div class="stat-change up">
      {{ $stats['approval_rate'] }}% approval rate
    </div>
  </div>

  <div class="stat-card animate-in delay-4">
    <div class="stat-icon red">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M15 9l-6 6M9 9l6 6"/>
      </svg>
    </div>
    <div class="stat-value" data-count="{{ $stats['rejected'] }}">0</div>
    <div class="stat-label">Rejected</div>
    <div class="stat-change down">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
      {{ $stats['rejection_rate'] }}% of total
    </div>
  </div>

  <div class="stat-card animate-in delay-5">
    <div class="stat-icon purple">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
    </div>
    <div class="stat-value" data-count="{{ $stats['total_applications'] }}">0</div>
    <div class="stat-label">Total Applications</div>
    <div class="stat-change up">
      All time
    </div>
  </div>

</div>{{-- /.stats-grid --}}

{{-- ── Two-column row ─────────────────────────────────────── --}}
<div class="grid-2">

  {{-- Popular Courses --}}
  <div class="panel animate-in delay-2">
    <div class="panel-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           style="width:17px;height:17px;color:var(--accent)">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6"  y1="20" x2="6"  y2="14"/>
      </svg>
      <span class="panel-title">Course Popularity</span>
    </div>
    <div class="panel-body">
      @foreach($popularCourses as $course)
        <div style="margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <span style="font-size:.83rem;font-weight:600">{{ $course['name'] }}</span>
            <span style="font-size:.78rem;color:var(--text-muted)">{{ $course['count'] }} enrolled</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill {{ $course['color'] ?? '' }}"
                 style="width:{{ $course['pct'] }}%"></div>
          </div>
        </div>
      @endforeach
    </div>
  </div>

</div>{{-- /.grid-2 --}}

{{-- ── Recent Applications Table ──────────────────────────── --}}
<div class="panel animate-in">
  <div class="panel-header">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         style="width:17px;height:17px;color:var(--accent)">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
    <span class="panel-title">Recent Applications</span>
    <a href="{{ route('admin.applications.index') }}" class="btn btn-outline btn-sm">
      View All
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>
    </a>
  </div>

  {{-- Filter Tabs --}}
  <div class="filters-bar" data-filter-group="recentTable">
    <button class="btn btn-sm btn-primary" data-filter-tab="all">All</button>
    <button class="btn btn-sm btn-outline" data-filter-tab="pending">Pending</button>
    <button class="btn btn-sm btn-outline" data-filter-tab="approved">Approved</button>
    <button class="btn btn-sm btn-outline" data-filter-tab="rejected">Rejected</button>
    <button class="btn btn-sm btn-outline" data-filter-tab="partial">Partial</button>
    <div style="margin-left:auto">
      <input type="text" class="filter-input" placeholder="Search applications…"
             data-table-search="recentTable" style="width:220px">
    </div>
  </div>

  <div class="table-wrap">
    <table class="admin-table" id="recentTable">
      <thead>
        <tr>
          <th>#</th>
          <th>Applicant</th>
          <th>Phone</th>
          <th>Course(s)</th>
          <th>Status</th>
          <th>Date</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        @forelse($recentApplications as $app)
          <tr>
            <td style="color:var(--text-muted);font-size:.78rem">{{ $app->id }}</td>
            <td>
              <div class="td-name">{{ $app->full_name }}</div>
              <div class="td-sub">{{ $app->email }}</div>
            </td>
            <td>{{ $app->phone }}</td>
            <td>
              @foreach($app->courses as $course)
                <span class="course-pill">{{ $course->title }}</span>
              @endforeach
            </td>
            <td>
              @include('admin.applications.partials.status-badge', ['status' => $app->status])
            </td>
            <td style="font-size:.8rem;color:var(--text-muted);white-space:nowrap">
              {{ $app->created_at->format('d M Y') }}
            </td>
            <td>
              <a href="{{ route('admin.applications.show', $app) }}"
                 class="btn btn-sm btn-outline">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                View
              </a>
            </td>
          </tr>
        @empty
          <tr>
            <td colspan="7">
              <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                </svg>
                <h3>No applications yet</h3>
                <p>New applications will appear here.</p>
              </div>
            </td>
          </tr>
        @endforelse
      </tbody>
    </table>
  </div>

  {{-- Pagination --}}
  @if($recentApplications->hasPages())
    <div class="pagination">
      @for($i = 1; $i <= $recentApplications->lastPage(); $i++)
        <a href="{{ $recentApplications->url($i) }}"
           class="page-btn {{ $recentApplications->currentPage() === $i ? 'active' : '' }}">{{ $i }}</a>
      @endfor
      <div class="pagination-info">
        Showing {{ $recentApplications->firstItem() }}–{{ $recentApplications->lastItem() }}
        of {{ $recentApplications->total() }}
      </div>
    </div>
  @endif

</div>{{-- /.panel --}}

@endsection
