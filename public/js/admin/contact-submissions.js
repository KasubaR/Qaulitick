// Admin Contact Submissions Management JavaScript

let currentPage = 1;
let totalPages = 1;
let currentSubmissionId = null;
let filters = {
    status: '',
    subject: '',
    search: '',
    startDate: '',
    endDate: ''
};

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication before initializing
    const isAuthenticated = await window.AuthUtils?.initializeAuthCheck();
    if (!isAuthenticated) {
        return; // Redirect will happen in initializeAuthCheck
    }
    
    initializeSubmissionsPage();
    setupEventListeners();
    loadSubmissions();
});

// Initialize submissions page
function initializeSubmissionsPage() {
    setupSidebar();
}

// Setup event listeners
function setupEventListeners() {
    // Sidebar toggle
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', toggleSidebar);
    }

    // Search
    const searchBtn = document.getElementById('searchBtn');
    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }

    const submissionSearch = document.getElementById('submissionSearch');
    if (submissionSearch) {
        submissionSearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleSearch();
            }
        });
    }

    // Filters
    const filterStatus = document.getElementById('filterStatus');
    const filterSubject = document.getElementById('filterSubject');
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');

    if (filterStatus) {
        filterStatus.addEventListener('change', () => {
            filters.status = filterStatus.value;
            currentPage = 1;
            loadSubmissions();
        });
    }

    if (filterSubject) {
        filterSubject.addEventListener('change', () => {
            filters.subject = filterSubject.value;
            currentPage = 1;
            loadSubmissions();
        });
    }

    if (startDate) {
        startDate.addEventListener('change', () => {
            filters.startDate = startDate.value;
            currentPage = 1;
            loadSubmissions();
        });
    }

    if (endDate) {
        endDate.addEventListener('change', () => {
            filters.endDate = endDate.value;
            currentPage = 1;
            loadSubmissions();
        });
    }

    // Clear filters
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', clearFilters);
    }

    // Refresh
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            currentPage = 1;
            loadSubmissions();
        });
    }

    // Pagination
    const prevPage = document.getElementById('prevPage');
    const nextPage = document.getElementById('nextPage');
    if (prevPage) {
        prevPage.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                loadSubmissions();
            }
        });
    }
    if (nextPage) {
        nextPage.addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                loadSubmissions();
            }
        });
    }

    // Modals
    setupModals();
}

// Setup sidebar
function setupSidebar() {
    const currentPath = window.location.pathname;
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        if (item.getAttribute('href') === currentPath) {
            item.classList.add('active');
        }
    });
}

// Toggle sidebar (mobile)
function toggleSidebar() {
    const sidebar = document.querySelector('.admin-sidebar');
    sidebar.classList.toggle('active');
}

// Handle search
function handleSearch() {
    const searchInput = document.getElementById('submissionSearch');
    if (searchInput) {
        filters.search = searchInput.value.trim();
        currentPage = 1;
        loadSubmissions();
    }
}

// Clear filters
function clearFilters() {
    filters = {
        status: '',
        subject: '',
        search: '',
        startDate: '',
        endDate: ''
    };

    // Reset form inputs
    const filterStatus = document.getElementById('filterStatus');
    const filterSubject = document.getElementById('filterSubject');
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    const submissionSearch = document.getElementById('submissionSearch');

    if (filterStatus) filterStatus.value = '';
    if (filterSubject) filterSubject.value = '';
    if (startDate) startDate.value = '';
    if (endDate) endDate.value = '';
    if (submissionSearch) submissionSearch.value = '';

    currentPage = 1;
    loadSubmissions();
}

// Load submissions from API
async function loadSubmissions() {
    try {
        const submissionsBody = document.getElementById('submissionsBody');
        if (submissionsBody) {
            submissionsBody.innerHTML = '<tr><td colspan="7" class="empty-state">Loading submissions...</td></tr>';
        }

        // Build query string
        const queryParams = new URLSearchParams({
            page: currentPage,
            limit: 50,
            ...Object.fromEntries(Object.entries(filters).filter(([_, v]) => v !== ''))
        });

        const response = await fetch(`/api/admin/contact-submissions?${queryParams}`);
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || 'Failed to load submissions');
        }

        // Update pagination
        totalPages = data.pagination.totalPages;
        updatePagination();

        // Render submissions
        renderSubmissions(data.data || []);

        // Update count
        const submissionsCount = document.getElementById('submissionsCount');
        if (submissionsCount) {
            submissionsCount.textContent = data.pagination.total || 0;
        }
    } catch (error) {
        console.error('Error loading submissions:', error);
        const submissionsBody = document.getElementById('submissionsBody');
        if (submissionsBody) {
            submissionsBody.innerHTML = `<tr><td colspan="7" class="empty-state error">Error loading submissions: ${error.message}</td></tr>`;
        }
    }
}

// Render submissions table
function renderSubmissions(submissions) {
    const submissionsBody = document.getElementById('submissionsBody');

    if (!submissionsBody) return;

    if (submissions.length === 0) {
        submissionsBody.innerHTML = '<tr><td colspan="7" class="empty-state">No submissions found</td></tr>';
        return;
    }

    const subjectLabels = {
        'product-inquiry': 'Product Inquiry',
        'order-support': 'Order Support',
        'shipping': 'Shipping & Delivery',
        'returns': 'Returns & Exchanges',
        'business': 'Business Partnership',
        'other': 'Other'
    };

    submissionsBody.innerHTML = submissions.map(submission => {
        const date = new Date(submission.createdAt);
        const formattedDate = date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const statusClass = {
            'new': 'status-badge new',
            'replied': 'status-badge replied',
            'archived': 'status-badge archived'
        }[submission.status] || 'status-badge';

        const statusLabel = submission.status.charAt(0).toUpperCase() + submission.status.slice(1);

        return `
            <tr>
                <td>${escapeHtml(submission.name)}</td>
                <td><a href="mailto:${escapeHtml(submission.email)}">${escapeHtml(submission.email)}</a></td>
                <td>${submission.phone ? escapeHtml(submission.phone) : '—'}</td>
                <td>${subjectLabels[submission.subject] || submission.subject}</td>
                <td><span class="${statusClass}">${statusLabel}</span></td>
                <td>${formattedDate}</td>
                <td>
                    <div class="action-menu-container">
                        <button class="action-menu-btn" onclick="toggleContactActionMenu('${submission._id}')" title="Actions">
                            <i class="fas fa-ellipsis-v"></i>
                        </button>
                        <div class="action-menu-dropdown" id="contactActionMenu-${submission._id}" style="display: none;">
                            <button class="action-menu-item" onclick="viewSubmission('${submission._id}'); closeContactActionMenu('${submission._id}');">
                                <i class="fas fa-eye"></i>
                                <span>View Details</span>
                            </button>
                            ${submission.status === 'new' ? `
                            <button class="action-menu-item" onclick="markAsReplied('${submission._id}'); closeContactActionMenu('${submission._id}');">
                                <i class="fas fa-check"></i>
                                <span>Mark as Replied</span>
                            </button>
                            ` : ''}
                            ${submission.status !== 'archived' ? `
                            <button class="action-menu-item" onclick="archiveSubmission('${submission._id}'); closeContactActionMenu('${submission._id}');">
                                <i class="fas fa-archive"></i>
                                <span>Archive</span>
                            </button>
                            ` : ''}
                            <div class="action-menu-divider"></div>
                            <button class="action-menu-item danger" onclick="deleteSubmission('${submission._id}'); closeContactActionMenu('${submission._id}');">
                                <i class="fas fa-trash"></i>
                                <span>Delete</span>
                            </button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Update pagination controls
function updatePagination() {
    const pagination = document.getElementById('pagination');
    const prevPage = document.getElementById('prevPage');
    const nextPage = document.getElementById('nextPage');
    const pageNumbers = document.getElementById('pageNumbers');

    if (!pagination) return;

    if (totalPages <= 1) {
        pagination.style.display = 'none';
        return;
    }

    pagination.style.display = 'flex';

    if (prevPage) prevPage.disabled = currentPage === 1;
    if (nextPage) nextPage.disabled = currentPage === totalPages;

    if (pageNumbers) {
        const maxPages = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxPages / 2));
        let endPage = Math.min(totalPages, startPage + maxPages - 1);
        if (endPage - startPage < maxPages - 1) startPage = Math.max(1, endPage - maxPages + 1);
        let html = '';
        for (let i = startPage; i <= endPage; i++) {
            html += `<span class="page-number ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</span>`;
        }
        pageNumbers.innerHTML = html;
        pageNumbers.querySelectorAll('.page-number').forEach(el => {
            el.addEventListener('click', () => {
                const page = parseInt(el.dataset.page);
                if (page !== currentPage) {
                    currentPage = page;
                    loadSubmissions();
                }
            });
        });
    }
}

// View submission details
async function viewSubmission(id) {
    try {
        const response = await fetch(`/api/admin/contact-submissions?limit=1&_id=${id}`);
        const data = await response.json();

        if (!data.success || !data.data || data.data.length === 0) {
            throw new Error('Submission not found');
        }

        const submission = data.data[0];
        currentSubmissionId = id;

        const subjectLabels = {
            'product-inquiry': 'Product Inquiry',
            'order-support': 'Order Support',
            'shipping': 'Shipping & Delivery',
            'returns': 'Returns & Exchanges',
            'business': 'Business Partnership',
            'other': 'Other'
        };

        const date = new Date(submission.createdAt);
        const formattedDate = date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const modalBody = document.getElementById('modalBody');
        if (modalBody) {
            modalBody.innerHTML = `
                <div class="submission-details">
                    <div class="detail-row">
                        <strong>Name:</strong>
                        <span>${escapeHtml(submission.name)}</span>
                    </div>
                    <div class="detail-row">
                        <strong>Email:</strong>
                        <span><a href="mailto:${escapeHtml(submission.email)}">${escapeHtml(submission.email)}</a></span>
                    </div>
                    ${submission.phone ? `
                    <div class="detail-row">
                        <strong>Phone:</strong>
                        <span>${escapeHtml(submission.phone)}</span>
                    </div>
                    ` : ''}
                    <div class="detail-row">
                        <strong>Subject:</strong>
                        <span>${subjectLabels[submission.subject] || submission.subject}</span>
                    </div>
                    <div class="detail-row">
                        <strong>Status:</strong>
                        <span class="status-badge ${submission.status}">${submission.status.charAt(0).toUpperCase() + submission.status.slice(1)}</span>
                    </div>
                    <div class="detail-row">
                        <strong>Submitted:</strong>
                        <span>${formattedDate}</span>
                    </div>
                    <div class="detail-row full-width">
                        <strong>Message:</strong>
                        <div class="message-content">${escapeHtml(submission.message).replace(/\n/g, '<br>')}</div>
                    </div>
                </div>
            `;
        }

        const modal = document.getElementById('submissionModal');
        if (modal) {
            modal.style.display = 'flex';
        }
    } catch (error) {
        console.error('Error loading submission:', error);
        alert('Failed to load submission details');
    }
}

// Mark submission as replied
async function markAsReplied(id) {
    try {
        const response = await fetch(`/api/admin/contact-submissions/${id}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: 'replied' })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || 'Failed to update status');
        }

        loadSubmissions();
        if (currentSubmissionId === id) {
            const modal = document.getElementById('submissionModal');
            if (modal) {
                modal.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error updating status:', error);
        alert('Failed to update submission status');
    }
}

// Archive submission
async function archiveSubmission(id) {
    try {
        const response = await fetch(`/api/admin/contact-submissions/${id}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: 'archived' })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || 'Failed to archive');
        }

        loadSubmissions();
        if (currentSubmissionId === id) {
            const modal = document.getElementById('submissionModal');
            if (modal) {
                modal.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error archiving submission:', error);
        alert('Failed to archive submission');
    }
}

// Delete submission
function deleteSubmission(id) {
    currentSubmissionId = id;
    const deleteModal = document.getElementById('deleteModal');
    if (deleteModal) {
        deleteModal.style.display = 'flex';
    }
}

// Confirm delete
async function confirmDelete() {
    if (!currentSubmissionId) return;

    try {
        const response = await fetch(`/api/admin/contact-submissions/${currentSubmissionId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || 'Failed to delete');
        }

        const deleteModal = document.getElementById('deleteModal');
        if (deleteModal) {
            deleteModal.style.display = 'none';
        }

        currentSubmissionId = null;
        loadSubmissions();
    } catch (error) {
        console.error('Error deleting submission:', error);
        alert('Failed to delete submission');
    }
}

// Setup modals
function setupModals() {
    // Close modal buttons
    const closeModal = document.getElementById('closeModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const closeDeleteModal = document.getElementById('closeDeleteModal');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const markRepliedBtn = document.getElementById('markRepliedBtn');
    const archiveBtn = document.getElementById('archiveBtn');

    if (closeModal) {
        closeModal.addEventListener('click', () => {
            const modal = document.getElementById('submissionModal');
            if (modal) modal.style.display = 'none';
        });
    }

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            const modal = document.getElementById('submissionModal');
            if (modal) modal.style.display = 'none';
        });
    }

    if (closeDeleteModal) {
        closeDeleteModal.addEventListener('click', () => {
            const modal = document.getElementById('deleteModal');
            if (modal) modal.style.display = 'none';
            currentSubmissionId = null;
        });
    }

    if (cancelDeleteBtn) {
        cancelDeleteBtn.addEventListener('click', () => {
            const modal = document.getElementById('deleteModal');
            if (modal) modal.style.display = 'none';
            currentSubmissionId = null;
        });
    }

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', confirmDelete);
    }

    if (markRepliedBtn) {
        markRepliedBtn.addEventListener('click', () => {
            if (currentSubmissionId) {
                markAsReplied(currentSubmissionId);
            }
        });
    }

    if (archiveBtn) {
        archiveBtn.addEventListener('click', () => {
            if (currentSubmissionId) {
                archiveSubmission(currentSubmissionId);
            }
        });
    }

    // Close on outside click
    const submissionModal = document.getElementById('submissionModal');
    const deleteModal = document.getElementById('deleteModal');

    if (submissionModal) {
        submissionModal.addEventListener('click', (e) => {
            if (e.target === submissionModal) {
                submissionModal.style.display = 'none';
            }
        });
    }

    if (deleteModal) {
        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) {
                deleteModal.style.display = 'none';
                currentSubmissionId = null;
            }
        });
    }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Action menu functions
function toggleContactActionMenu(submissionId) {
    // Close all other menus first
    document.querySelectorAll('.action-menu-dropdown').forEach(menu => {
        if (menu.id !== `contactActionMenu-${submissionId}`) {
            menu.style.display = 'none';
        }
    });
    
    const menu = document.getElementById(`contactActionMenu-${submissionId}`);
    if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }
}

function closeContactActionMenu(submissionId) {
    const menu = document.getElementById(`contactActionMenu-${submissionId}`);
    if (menu) {
        menu.style.display = 'none';
    }
}

// Close menus when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.action-menu-container')) {
        document.querySelectorAll('.action-menu-dropdown').forEach(menu => {
            menu.style.display = 'none';
        });
    }
});

// Make functions available globally for onclick handlers
window.viewSubmission = viewSubmission;
window.markAsReplied = markAsReplied;
window.archiveSubmission = archiveSubmission;
window.deleteSubmission = deleteSubmission;
window.toggleContactActionMenu = toggleContactActionMenu;
window.closeContactActionMenu = closeContactActionMenu;

