// Admin Products - Table rendering & list interactions
// Responsibilities:
// - renderProducts(products)
// - updateProductsCount(count)
// (Row action buttons are wired in products.js via event delegation)

(function (window) {
    /**
     * Render products into the admin products table
     * @param {Array<object>} products
     */
    function renderProducts(products) {
        const tbody = document.getElementById('productsTableBody');
        if (!tbody) return;
        
        if (!Array.isArray(products) || products.length === 0) {
            tbody.innerHTML = [
                '<tr>',
                '    <td colspan="10" class="empty-state">',
                '        <i class="fas fa-box-open"></i>',
                '        <p>No products found</p>',
                '    </td>',
                '</tr>'
            ].join('');
            return;
        }
        
        tbody.innerHTML = products.map(function (product) {
            // Use the canonical Sequelize primary key (id); fall back to the _id shim
            // only while the compatibility shim in mysql.js is still in place.
            var pid = product.id != null ? product.id : product._id;

            // Normalize images: MySQL JSON column can come back as a string
            var images = product.images;
            if (typeof images === 'string') {
                try { images = JSON.parse(images); } catch (e) { images = []; }
            }
            if (!Array.isArray(images)) images = [];
            var imageUrl = images[0] || '/images/placeholder.jpg';
            var gender = product.gender || product.category || 'N/A';
            var price = (product.price || 0).toLocaleString();
            var discount = product.discount || 0;
            var stock = product.stock || 0;
            var status = product.status || 'active';
            var createdAt = product.createdAt || new Date().toISOString();
            var formattedDate = window.formatDate
                ? window.formatDate(createdAt)
                : createdAt;

            return [
                '<tr>',
                '    <td>',
                '        <input type="checkbox" class="product-checkbox" data-product-id="' + pid + '" title="Select product">',
                '    </td>',
                '    <td>',
                '        <img src="' + imageUrl + '" alt="' + (product.model || '') + '">',
                '    </td>',
                '    <td>',
                '        <div class="product-name-cell">',
                '            <span class="product-name">' + (product.model || '') + '</span>',
                '            <span class="product-sku">SKU: ' + (product.sku || '') + '</span>',
                '        </div>',
                '    </td>',
                '    <td>' + gender + '</td>',
                '    <td>K' + price + '</td>',
                '    <td>' + discount + '%</td>',
                '    <td>' + stock + '</td>',
                '    <td>',
                '        <span class="badge ' + (status === 'active' ? 'badge-approved' : 'badge-rejected') + '">',
                String(status),
                '        </span>',
                '    </td>',
                '    <td>' + formattedDate + '</td>',
                '    <td>',
                '        <div class="action-menu-container">',
                '            <button class="action-menu-btn" data-product-id="' + pid + '" title="Actions">',
                '                <i class="fas fa-ellipsis-v"></i>',
                '            </button>',
                '            <div class="action-menu-dropdown" id="productActionMenu-' + pid + '" style="display: none;">',
                '                <button class="action-menu-item" data-action="view" data-product-id="' + pid + '">',
                '                    <i class="fas fa-eye"></i>',
                '                    <span>View</span>',
                '                </button>',
                '                <button class="action-menu-item" data-action="edit" data-product-id="' + pid + '">',
                '                    <i class="fas fa-edit"></i>',
                '                    <span>Edit</span>',
                '                </button>',
                '                <button class="action-menu-item" data-action="duplicate" data-product-id="' + pid + '">',
                '                    <i class="fas fa-copy"></i>',
                '                    <span>Duplicate</span>',
                '                </button>',
                '                <div class="action-menu-divider"></div>',
                '                <button class="action-menu-item danger" data-action="delete" data-product-id="' + pid + '" data-product-name="' + String(product.model || 'Unknown Product').replace(/"/g, '&quot;') + '">',
                '                    <i class="fas fa-trash"></i>',
                '                    <span>Delete</span>',
                '                </button>',
                '            </div>',
                '        </div>',
                '    </td>',
                '</tr>'
            ].join('');
        }).join('');
    }

    /**
     * Update the products count display in the header
     * @param {number} count
     */
    function updateProductsCount(count) {
        var countElement = document.getElementById('productsCount');
        if (countElement) {
            countElement.textContent = count;
        }
    }

    // Expose on a namespace and also as globals (for backwards compatibility)
    window.AdminProductsTable = {
        renderProducts: renderProducts,
        updateProductsCount: updateProductsCount
    };

    window.renderProducts = renderProducts;
    window.updateProductsCount = updateProductsCount;
})(window);


