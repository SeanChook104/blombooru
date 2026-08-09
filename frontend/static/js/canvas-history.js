// Maximum thumbnails shown per history row before "+N more"
const CANVAS_HISTORY_THUMB_LIMIT = 8;

class CanvasHistoryPage extends BaseGallery {
    constructor() {
        super({
            gridSelector: '#canvas-history-list',
            enableRatingFilter: false,
            enableSorting: false,
            enableTooltips: false,
            enablePagination: true
        });

        if (this.elements.grid) {
            this.init();
        }
    }

    init() {
        this.initCommon();

        this.currentPage = parseInt(this.getUrlParam('page', 1)) || 1;

        const clearBtn = document.getElementById('clear-canvas-history-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearAll());
        }

        window.addEventListener('popstate', () => {
            this.currentPage = parseInt(this.getUrlParam('page', 1)) || 1;
            this.loadContent();
        });

        this.loadContent();
    }

    async loadContent() {
        if (this.isLoading) return false;

        this.isLoading = true;
        this.showLoading();

        try {
            const response = await fetch(`/api/canvas-history?page=${this.currentPage}`, {
                credentials: 'include'
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            this.totalPages = data.pages || 1;

            if (this.adjustPageIfNeeded(this.totalPages)) {
                this.isLoading = false;
                return this.loadContent();
            }

            this.renderEntries(data.items || []);
            this.renderPagination();

            const clearBtn = document.getElementById('clear-canvas-history-btn');
            if (clearBtn) {
                clearBtn.style.display = (data.total > 0 && app.isAdminMode) ? '' : 'none';
            }

            return true;
        } catch (error) {
            console.error('Error loading canvas history:', error);
            this.showError(error.message);
            return false;
        } finally {
            this.isLoading = false;
            this.hideLoading();
        }
    }

    renderEntries(entries) {
        if (!entries.length) {
            this.elements.grid.innerHTML =
                `<p class="text-secondary text-center py-8">${window.i18n.t('canvas_history.empty')}</p>`;
            return;
        }

        this.elements.grid.innerHTML = '';
        entries.forEach(entry => {
            this.elements.grid.appendChild(this.createEntryRow(entry));
        });
    }

    createEntryRow(entry) {
        const ids = entry.media_ids || [];
        const shown = ids.slice(0, CANVAS_HISTORY_THUMB_LIMIT);
        const remaining = ids.length - shown.length;

        const row = document.createElement('div');
        row.className = 'surface border p-3 flex flex-col sm:flex-row sm:items-center gap-3';
        row.dataset.id = entry.id;

        const thumbs = document.createElement('div');
        thumbs.className = 'flex flex-wrap gap-1 flex-1 min-w-0';
        shown.forEach(id => {
            const img = document.createElement('img');
            img.src = `/api/media/${id}/thumbnail`;
            img.loading = 'lazy';
            img.className = 'w-12 h-12 object-cover border';
            img.onerror = () => { img.src = '/static/images/no-thumbnail.png'; };
            thumbs.appendChild(img);
        });

        if (remaining > 0) {
            const more = document.createElement('span');
            more.className = 'text-secondary text-xs self-center px-1';
            more.textContent = window.i18n.t('canvas_history.more_items', { count: remaining });
            thumbs.appendChild(more);
        }

        const meta = document.createElement('div');
        meta.className = 'text-xs flex-shrink-0';
        const opened = new Date(entry.last_opened_at);
        meta.innerHTML = `
            <div class="font-bold">${opened.toLocaleString()}</div>
            <div class="text-secondary">${window.i18n.t('canvas_history.item_count', { count: entry.item_count })}</div>
        `;

        const actions = document.createElement('div');
        actions.className = 'flex gap-2 flex-shrink-0';

        const viewBtn = document.createElement('button');
        viewBtn.className = 'btn px-3 py-1 text-xs';
        viewBtn.textContent = window.i18n.t('canvas_history.view');
        viewBtn.addEventListener('click', () => {
            window.location.href = `/canvas?ids=${ids.join(',')}`;
        });
        actions.appendChild(viewBtn);

        if (app.isAdminMode) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn px-3 py-1 text-xs';
            deleteBtn.textContent = window.i18n.t('common.delete');
            deleteBtn.addEventListener('click', () => this.deleteEntry(entry.id));
            actions.appendChild(deleteBtn);
        }

        row.appendChild(thumbs);
        row.appendChild(meta);
        row.appendChild(actions);
        return row;
    }

    async deleteEntry(entryId) {
        const modal = new ModalHelper({
            id: 'delete-canvas-history-modal',
            type: 'warning',
            title: window.i18n.t('canvas_history.delete_title'),
            message: window.i18n.t('canvas_history.delete_message'),
            confirmText: window.i18n.t('common.delete'),
            cancelText: window.i18n.t('common.cancel'),
            onConfirm: async () => {
                try {
                    await app.apiCall(`/api/canvas-history/${entryId}`, { method: 'DELETE' });
                    this.loadContent();
                } catch (error) {
                    app.showNotification(error.message, 'error');
                }
            }
        });

        modal.show();
    }

    async clearAll() {
        const modal = new ModalHelper({
            id: 'clear-canvas-history-modal',
            type: 'warning',
            title: window.i18n.t('canvas_history.clear_title'),
            message: window.i18n.t('canvas_history.clear_message'),
            confirmText: window.i18n.t('canvas_history.clear_all'),
            cancelText: window.i18n.t('common.cancel'),
            onConfirm: async () => {
                try {
                    await app.apiCall('/api/canvas-history', { method: 'DELETE' });
                    this.currentPage = 1;
                    this.loadContent();
                } catch (error) {
                    app.showNotification(error.message, 'error');
                }
            }
        });

        modal.show();
    }
}

// Initialize
if (document.getElementById('canvas-history-list')) {
    window.canvasHistoryPage = new CanvasHistoryPage();
}
