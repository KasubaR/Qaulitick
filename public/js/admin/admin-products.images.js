// Admin Products - Image upload & preview module
// Responsibilities:
// - setupImageUpload()
// - handleImageUpload(files)
// - removeImage(button)

function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
}
// - Drag-and-drop reordering
// - Set primary/featured image
// - Image preview with zoom
// - Delete individual images (with API call)

(function (window) {
    let currentProductId = null;
    let draggedElement = null;
    // Map of unique pendingKey -> File object for pending (not yet uploaded) files.
    // Keys are auto-incrementing integers so two files with the same name never collide.
    const pendingFiles = new Map();
    let _pendingKeyCounter = 0;
    /**
     * Setup image upload interactions (click, drag & drop)
     */
    function setupImageUpload() {
        const uploadArea = document.getElementById('imageUploadArea');
        const fileInput = document.getElementById('productImages');
        
        if (!uploadArea || !fileInput) {
            return;
        }

        uploadArea.addEventListener('click', () => fileInput.click());
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = 'var(--admin-gold)';
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.style.borderColor = 'var(--admin-border)';
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = 'var(--admin-border)';
            const files = e.dataTransfer.files;
            handleImageUpload(files);
        });
        
        fileInput.addEventListener('change', (e) => {
            handleImageUpload(e.target.files);
        });
    }

    /**
     * Handle client-side image validation and preview rendering
     * @param {FileList|Array<File>} files
     */
    function handleImageUpload(files) {
        const previewGrid = document.getElementById('imagePreviewGrid');
        if (!previewGrid) return;
        
        const maxFileSize = 10 * 1024 * 1024; // 10MB
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        const maxImages = 10;
        
        Array.from(files).forEach((file) => {
            // Validate file type
            if (!allowedTypes.includes(file.type)) {
                if (window.showNotification) {
                    window.showNotification(
                        `File "${file.name}" is not a valid image format. Please use JPG, PNG, or WebP.`,
                        'error'
                    );
                }
                return;
            }
            
            // Validate file size
            if (file.size > maxFileSize) {
                if (window.showNotification) {
                    window.showNotification(
                        `File "${file.name}" is too large. Maximum size is 10MB.`,
                        'error'
                    );
                }
                return;
            }
            
            // Check maximum number of images
            const currentImages = previewGrid.querySelectorAll('.image-preview-item').length;
            if (currentImages >= maxImages) {
                if (window.showNotification) {
                    window.showNotification(
                        `Maximum ${maxImages} images allowed. Please remove some images first.`,
                        'error'
                    );
                }
                return;
            }
            
            // Validate and create preview
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = function () {
                        const minDimension = 800;
                        const maxDimension = 3000;
                        
                        if (this.width < minDimension || this.height < minDimension) {
                            if (window.showNotification) {
                                window.showNotification(
                                    `Image "${file.name}" is too small. Minimum size is ${minDimension}x${minDimension}px.`,
                                    'warning'
                                );
                            }
                        }
                        
                        if (this.width > maxDimension || this.height > maxDimension) {
                            if (window.showNotification) {
                                window.showNotification(
                                    `Image "${file.name}" is very large (${this.width}x${this.height}px). Recommended maximum is ${maxDimension}x${maxDimension}px.`,
                                    'warning'
                                );
                            }
                        }
                        
                        const previewItem = document.createElement('div');
                        const pendingKey = String(++_pendingKeyCounter);
                        previewItem.className = 'image-preview-item';
                        previewItem.setAttribute('data-pending-key', pendingKey);  // unique key for Map lookup
                        previewItem.setAttribute('data-file-name', file.name);     // display only
                        previewItem.setAttribute('data-file-size', file.size);
                        previewItem.setAttribute('draggable', 'true');
                        previewItem.setAttribute('data-image-url', e.target.result); // local data URI (never sent to server)
                        // Store the File object keyed by the unique counter, not the filename
                        pendingFiles.set(pendingKey, file);
                        
                        // Check if this is the first image (primary)
                        const isFirst = previewGrid.querySelectorAll('.image-preview-item').length === 0;
                        
                        previewItem.innerHTML = `
                            <div class="image-preview-wrapper">
                                <img src="${e.target.result}" alt="Preview" onclick="zoomImage(this)">
                                ${isFirst ? '<span class="primary-badge">Primary</span>' : ''}
                            </div>
                            <div class="image-info">
                                <span class="image-name">${file.name}</span>
                                <span class="image-size">${(file.size / 1024 / 1024).toFixed(2)} MB</span>
                                <span class="image-dimensions">${this.width}x${this.height}px</span>
                            </div>
                            <div class="image-actions">
                                ${!isFirst ? '<button type="button" class="set-primary-btn" onclick="setPrimaryImage(this)" title="Set as primary image"><i class="fas fa-star"></i></button>' : ''}
                                <button type="button" class="remove-image-btn" onclick="removeImage(this)" title="Remove image">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        `;
                        
                        // Add drag event listeners
                        setupDragAndDrop(previewItem);
                        
                        previewGrid.appendChild(previewItem);
                        
                        // Update primary badges after adding
                        updatePrimaryBadges();
                    };
                    img.onerror = function () {
                        if (window.showNotification) {
                            window.showNotification(
                                `Failed to load image "${file.name}". Please check if it's a valid image file.`,
                                'error'
                            );
                        }
                    };
                    img.src = e.target.result;
                };
                reader.onerror = () => {
                    if (window.showNotification) {
                        window.showNotification(
                            `Failed to read file "${file.name}".`,
                            'error'
                        );
                    }
                };
                reader.readAsDataURL(file);
            }
        });
    }

    /**
     * Set current product ID (called from products.js when editing)
     * @param {String} productId
     */
    function setCurrentProductId(productId) {
        currentProductId = productId;
    }

    /**
     * Setup drag-and-drop for image reordering
     * @param {HTMLElement} item
     */
    function setupDragAndDrop(item) {
        item.addEventListener('dragstart', (e) => {
            draggedElement = item;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        
        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            draggedElement = null;
        });
        
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            const afterElement = getDragAfterElement(item.parentElement, e.clientY);
            if (afterElement == null) {
                item.parentElement.appendChild(draggedElement);
            } else {
                item.parentElement.insertBefore(draggedElement, afterElement);
            }
        });
        
        item.addEventListener('drop', async (e) => {
            e.preventDefault();
            item.classList.remove('dragging');
            
            // Update primary badges
            updatePrimaryBadges();
            
            // If product is saved (has ID), update order on server
            if (currentProductId) {
                await saveImageOrder();
            }
        });
    }

    /**
     * Get element after which to insert dragged element
     * @param {HTMLElement} container
     * @param {Number} y
     * @returns {HTMLElement|null}
     */
    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.image-preview-item:not(.dragging)')];
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    /**
     * Save image order to server
     */
    async function saveImageOrder() {
        if (!currentProductId) return;
        
        const previewGrid = document.getElementById('imagePreviewGrid');
        if (!previewGrid) return;
        
        const items = previewGrid.querySelectorAll('.image-preview-item');
        // Only include server-side URLs — skip data URIs (pending files not yet uploaded)
        const imageOrder = Array.from(items).map(item =>
            item.getAttribute('data-image-url') || item.querySelector('img')?.src || ''
        ).filter(url => url && !url.startsWith('data:'));

        // If there are pending (unsaved) images mixed in, skip the reorder API call.
        // The correct order will be persisted when the product form is saved.
        const hasPending = Array.from(items).some(item => item.getAttribute('data-pending-key'));
        if (hasPending) {
            if (window.showNotification) {
                window.showNotification('Save the product first to lock in the image order.', 'info');
            }
            return;
        }

        if (imageOrder.length === 0) return;
        
        try {
            const response = await fetch(`/api/products/${currentProductId}/images/reorder`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken()
                },
                body: JSON.stringify({ imageOrder })
            });
            
            const data = await response.json();
            
            if (!response.ok || !data.success) {
                throw new Error(data.message || 'Failed to reorder images');
            }
            
            if (window.showNotification) {
                window.showNotification('Image order saved', 'success');
            }
        } catch (error) {
            console.error('[Image Management] Error saving image order:', error);
            if (window.showNotification) {
                window.showNotification('Error saving image order: ' + error.message, 'error');
            }
        }
    }

    /**
     * Set primary/featured image
     * @param {HTMLElement} btn
     */
    async function setPrimaryImage(btn) {
        const item = btn.closest('.image-preview-item');
        if (!item) return;
        
        const previewGrid = document.getElementById('imagePreviewGrid');
        if (!previewGrid) return;
        
        // Move item to first position in DOM
        previewGrid.insertBefore(item, previewGrid.firstChild);
        
        // Update primary badges
        updatePrimaryBadges();
        
        // If product is saved (has ID), update on server — but only for already-uploaded images.
        // Pending items still have a data URI; their final URL isn't known until upload.
        if (currentProductId) {
            const imageUrl = item.getAttribute('data-image-url') ||
                             item.querySelector('img')?.src || '';

            if (imageUrl && imageUrl.startsWith('data:')) {
                // Local preview only — order will be persisted at form-save time
                return;
            }

            if (imageUrl) {
                try {
                    const response = await fetch(`/api/products/${currentProductId}/images/primary`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': getCsrfToken()
                        },
                        body: JSON.stringify({ imageUrl })
                    });
                    
                    const data = await response.json();
                    
                    if (!response.ok || !data.success) {
                        throw new Error(data.message || 'Failed to set primary image');
                    }
                    
                    if (window.showNotification) {
                        window.showNotification('Primary image updated', 'success');
                    }
                } catch (error) {
                    console.error('[Image Management] Error setting primary image:', error);
                    if (window.showNotification) {
                        window.showNotification('Error setting primary image: ' + error.message, 'error');
                    }
                }
            }
        }
    }

    /**
     * Update primary badges on all images
     */
    function updatePrimaryBadges() {
        const previewGrid = document.getElementById('imagePreviewGrid');
        if (!previewGrid) return;
        
        const items = previewGrid.querySelectorAll('.image-preview-item');
        items.forEach((item, index) => {
            let badge = item.querySelector('.primary-badge');
            if (index === 0) {
                // First image is primary
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'primary-badge';
                    badge.textContent = 'Primary';
                    item.querySelector('.image-preview-wrapper').appendChild(badge);
                }
                // Hide set primary button on first image
                const setPrimaryBtn = item.querySelector('.set-primary-btn');
                if (setPrimaryBtn) setPrimaryBtn.style.display = 'none';
            } else {
                // Remove badge from non-primary images
                if (badge) badge.remove();
                // Show set primary button on other images
                const setPrimaryBtn = item.querySelector('.set-primary-btn');
                if (setPrimaryBtn) setPrimaryBtn.style.display = 'block';
            }
        });
    }

    /**
     * Remove a single image preview item
     * @param {HTMLElement} btn
     */
    async function removeImage(btn) {
        const item = btn.closest('.image-preview-item');
        if (!item) return;
        
        const imageUrl = item.getAttribute('data-image-url') || 
                        item.querySelector('img')?.src || 
                        '';
        
        // Confirm deletion
        if (!confirm('Are you sure you want to remove this image?')) {
            return;
        }
        
        // If product is saved (has ID) and image is from server, delete from server
        if (currentProductId && imageUrl && imageUrl.startsWith('/uploads/')) {
            try {
                const encodedUrl = encodeURIComponent(imageUrl);
                const response = await fetch(`/api/products/${currentProductId}/images/${encodedUrl}`, {
                    method: 'DELETE',
                    headers: { 'X-CSRF-Token': getCsrfToken() }
                });
                
                const data = await response.json();
                
                if (!response.ok || !data.success) {
                    throw new Error(data.message || 'Failed to delete image');
                }
                
                if (window.showNotification) {
                    window.showNotification('Image deleted successfully', 'success');
                }
            } catch (error) {
                console.error('[Image Management] Error deleting image:', error);
                if (window.showNotification) {
                    window.showNotification('Error deleting image: ' + error.message, 'error');
                }
                return; // Don't remove from UI if server deletion failed
            }
        }
        
        // Remove from pending files map if it was a new (not yet uploaded) file
        const pendingKey = item.getAttribute('data-pending-key');
        if (pendingKey) pendingFiles.delete(pendingKey);

        // Remove from UI
        item.remove();

        // Update primary badges
        updatePrimaryBadges();
    }

    /**
     * Zoom image on click
     * @param {HTMLElement} img
     */
    function zoomImage(img) {
        // Create zoom modal
        const zoomModal = document.createElement('div');
        zoomModal.className = 'image-zoom-modal';
        zoomModal.innerHTML = `
            <div class="image-zoom-content">
                <button class="image-zoom-close" onclick="this.closest('.image-zoom-modal').remove()">
                    <i class="fas fa-times"></i>
                </button>
                <img src="${img.src}" alt="Zoomed image">
            </div>
        `;
        
        document.body.appendChild(zoomModal);
        
        // Close on background click
        zoomModal.addEventListener('click', (e) => {
            if (e.target === zoomModal) {
                zoomModal.remove();
            }
        });
        
        // Close on Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                zoomModal.remove();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }

    /**
     * Initialize image management for existing product images
     * Called when loading product data
     * @param {Array<String>} imageUrls
     * @param {String} productId
     */
    function initializeProductImages(imageUrls, productId) {
        currentProductId = productId;
        const previewGrid = document.getElementById('imagePreviewGrid');
        if (!previewGrid) return;
        
        // Clear existing previews
        previewGrid.innerHTML = '';
        
        // Add existing images
        imageUrls.forEach((imageUrl, index) => {
            const previewItem = document.createElement('div');
            previewItem.className = 'image-preview-item';
            previewItem.setAttribute('draggable', 'true');
            previewItem.setAttribute('data-image-url', imageUrl);
            
            const isFirst = index === 0;
            
            previewItem.innerHTML = `
                <div class="image-preview-wrapper">
                    <img src="${imageUrl}" alt="Product image" onclick="zoomImage(this)">
                    ${isFirst ? '<span class="primary-badge">Primary</span>' : ''}
                </div>
                <div class="image-info">
                    <span class="image-name">Image ${index + 1}</span>
                </div>
                <div class="image-actions">
                    ${!isFirst ? '<button type="button" class="set-primary-btn" onclick="setPrimaryImage(this)" title="Set as primary image"><i class="fas fa-star"></i></button>' : ''}
                    <button type="button" class="remove-image-btn" onclick="removeImage(this)" title="Remove image">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
            
            // Add drag event listeners
            setupDragAndDrop(previewItem);
            
            previewGrid.appendChild(previewItem);
        });
        
        updatePrimaryBadges();
    }

    /**
     * Upload images to server and get URLs
     * @param {FileList|Array<File>} files - Files to upload
     * @returns {Promise<Array<string>>} Array of image URLs
     */
    async function uploadImages(files) {
        if (!files || files.length === 0) {
            return [];
        }
        
        // Convert FileList to Array
        const filesArray = Array.from(files);
        
        // Create FormData
        const formData = new FormData();
        filesArray.forEach((file, index) => {
            formData.append('images', file);
        });
        
        try {
            // Show loading notification
            if (window.showNotification) {
                window.showNotification('Uploading images...', 'info');
            }
            
            // Make upload request
            const response = await fetch('/api/products/upload-images', {
                method: 'POST',
                headers: { 'X-CSRF-Token': getCsrfToken() },
                body: formData
                // Don't set Content-Type header - browser will set it with boundary for FormData
            });
            
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Failed to upload images');
            }
            
            // Show success notification
            if (window.showNotification) {
                window.showNotification(result.message || 'Images uploaded successfully!', 'success');
            }
            
            return result.images || [];
        } catch (error) {
            console.error('[Image Upload] Error uploading images:', error);
            if (window.showNotification) {
                window.showNotification('Error uploading images: ' + error.message, 'error');
            }
            throw error;
        }
    }

    /**
     * Return all pending (not yet uploaded) File objects and clear the map.
     * Called by handleFormSubmit before saving a product.
     */
    function getNewFiles() {
        const files = Array.from(pendingFiles.values());
        pendingFiles.clear();
        return files;
    }

    // Expose functions globally so existing code can use them
    window.setupImageUpload = setupImageUpload;
    window.handleImageUpload = handleImageUpload;
    window.removeImage = removeImage;
    window.uploadImages = uploadImages;
    window.setPrimaryImage = setPrimaryImage;
    window.zoomImage = zoomImage;
    window.setCurrentProductId = setCurrentProductId;
    window.initializeProductImages = initializeProductImages;
    window.getNewFiles = getNewFiles;
})(window);


