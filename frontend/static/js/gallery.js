class Gallery extends BaseGallery {
    constructor() {
        super({
            gridSelector: '#gallery-grid',
            defaultSort: 'uploaded_at',
            enableAutoPaging: true,
            selectionStorageKey: GALLERY_SELECTED_STORAGE_KEY
        });

        if (this.elements.grid) {
            this.init();
        }
    }

    init() {
        this.initCommon();

        // Get page from URL
        this.currentPage = parseInt(this.getUrlParam('page', 1));

        window.addEventListener('popstate', () => {
            this.currentPage = parseInt(this.getUrlParam('page', 1)) || 1;
            this.autoPagingAppend = false;
            this.loadContent();
        });

        this.loadContent();
    }

    async loadContent() {
        if (this.isLoading) return false;

        const appendMode = this.autoPagingAppend && this.currentPage > 1;

        this.isLoading = true;
        if (!appendMode) {
            this.showLoading();
            this.elements.grid.innerHTML = '';
            this.tagCounts.clear();
        }

        try {
            const apiParams = new URLSearchParams();

            apiParams.set('page', this.currentPage);
            apiParams.set('rating', this.currentRating);
            apiParams.set('sort', this.getSortValue());
            apiParams.set('order', this.getOrderValue());

            const urlParams = new URLSearchParams(window.location.search);
            const searchQuery = urlParams.get('q');

            let endpoint = '/api/media/';

            let combinedQuery = '';
            if (searchQuery) combinedQuery = searchQuery;
            if (this.currentCustomFilter) {
                combinedQuery = combinedQuery ? `${combinedQuery} ${this.currentCustomFilter}` : this.currentCustomFilter;
            }

            if (combinedQuery) {
                endpoint = '/api/search';
                apiParams.set('q', combinedQuery);
            }

            const response = await fetch(`${endpoint}?${apiParams.toString()}`, {
                credentials: 'include'
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
                throw new Error(error.detail || `HTTP ${response.status}`);
            }

            const data = await response.json();
            this.totalPages = data.pages || 1;

            if (this.adjustPageIfNeeded(this.totalPages) && !appendMode) {
                this.isLoading = false;
                return this.loadContent();
            }

            if (data.items && data.items.length > 0) {
                if (!appendMode) {
                    this.processTagCounts(data.items);
                }
                this.renderItems(data.items);
                if (!appendMode) {
                    this.renderPopularTags();
                }
                this.renderPagination();
                this.updateVisibleSelectionState();
            } else if (!appendMode && this.currentPage === 1) {
                this.showEmptyState(searchQuery ? window.i18n.t('gallery.no_results_found') : window.i18n.t('gallery.no_media_found'));
                this.renderPagination();
            } else if (!appendMode) {
                this.renderPagination();
            }

            return true;

        } catch (error) {
            console.error('Error loading gallery:', error);
            if (!appendMode) {
                this.showError(error.message);
            }
            return false;
        } finally {
            this.isLoading = false;
            if (!appendMode) {
                this.hideLoading();
            }
        }
    }

    renderItems(items, pageNum = this.currentPage) {
        if (this.isAutoPagingEnabled()) {
            this.appendGalleryPageBreak(pageNum);
        }

        items.forEach(item => {
            const element = this.createGalleryItem(item);
            this.elements.grid.appendChild(element);
        });
    }
}

// Initialize
if (document.getElementById('gallery-grid')) {
    window.gallery = new Gallery();
}
