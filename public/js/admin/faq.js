(function () {
    const tbody = document.getElementById('faqTableBody');
    const modal = document.getElementById('faqModal');
    const form = document.getElementById('faqForm');
    const modalTitle = document.getElementById('faqModalTitle');
    const categoryList = document.getElementById('faqCategoryList');
    const fields = {
        id: document.getElementById('faqId'),
        question: document.getElementById('faqQuestion'),
        answer: document.getElementById('faqAnswer'),
        category: document.getElementById('faqCategory'),
        sortOrder: document.getElementById('faqSortOrder'),
        published: document.getElementById('faqPublished')
    };

    let faqs = [];

    function csrfToken() {
        return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
    }

    async function api(url, method, body) {
        const response = await fetch(url, {
            method,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
            body: body ? JSON.stringify(body) : undefined
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
            throw new Error(data.message || `Request failed (${response.status})`);
        }
        return data;
    }

    function stateRow(text) {
        tbody.replaceChildren();
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.className = 'faq-state-cell';
        td.textContent = text;
        tr.appendChild(td);
        tbody.appendChild(tr);
    }

    function cell(text, className) {
        const td = document.createElement('td');
        if (className) td.className = className;
        td.textContent = text;
        return td;
    }

    function actionButton(label, icon, className, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = className;
        btn.title = label;
        btn.innerHTML = `<i class="fas ${icon}"></i>`;
        btn.addEventListener('click', onClick);
        return btn;
    }

    function render() {
        categoryList.replaceChildren();
        new Set(faqs.map(f => f.category).filter(Boolean)).forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            categoryList.appendChild(option);
        });

        if (faqs.length === 0) {
            stateRow('No FAQs yet. Click "New FAQ" to add one.');
            return;
        }

        tbody.replaceChildren();
        faqs.forEach(faq => {
            const tr = document.createElement('tr');
            tr.appendChild(cell(String(faq.sortOrder)));
            tr.appendChild(cell(faq.question, 'faq-question-cell'));
            tr.appendChild(cell(faq.category || 'General'));

            const statusTd = document.createElement('td');
            const badge = document.createElement('span');
            badge.className = `faq-badge ${faq.isPublished ? 'faq-badge--live' : 'faq-badge--draft'}`;
            badge.textContent = faq.isPublished ? 'Published' : 'Hidden';
            statusTd.appendChild(badge);
            tr.appendChild(statusTd);

            const actionsTd = document.createElement('td');
            const actions = document.createElement('div');
            actions.className = 'faq-actions';
            actions.appendChild(actionButton('Edit', 'fa-pen', 'btn-outline', () => openModal(faq)));
            actions.appendChild(actionButton('Delete', 'fa-trash', 'btn-danger', () => removeFaq(faq)));
            actionsTd.appendChild(actions);
            tr.appendChild(actionsTd);

            tbody.appendChild(tr);
        });
    }

    async function load() {
        try {
            const data = await api('/api/admin/faqs', 'GET');
            faqs = data.faqs || [];
            render();
        } catch (error) {
            stateRow(`Failed to load FAQs: ${error.message}`);
        }
    }

    function openModal(faq) {
        form.reset();
        fields.id.value = faq ? faq.id : '';
        fields.question.value = faq ? faq.question : '';
        fields.answer.value = faq ? faq.answer : '';
        fields.category.value = faq && faq.category ? faq.category : '';
        fields.sortOrder.value = faq ? faq.sortOrder : (faqs.length ? Math.max(...faqs.map(f => f.sortOrder)) + 1 : 0);
        fields.published.checked = faq ? !!faq.isPublished : true;
        modalTitle.textContent = faq ? 'Edit FAQ' : 'New FAQ';
        modal.style.display = 'flex';
        fields.question.focus();
    }

    function closeModal() {
        modal.style.display = 'none';
    }

    async function removeFaq(faq) {
        if (!window.confirm(`Delete this FAQ?\n\n${faq.question}`)) return;
        try {
            await api(`/api/admin/faqs/${faq.id}`, 'DELETE');
            await load();
        } catch (error) {
            window.alert(error.message);
        }
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const id = fields.id.value;
        const payload = {
            question: fields.question.value,
            answer: fields.answer.value,
            category: fields.category.value,
            sortOrder: fields.sortOrder.value,
            isPublished: fields.published.checked
        };
        try {
            await api(id ? `/api/admin/faqs/${id}` : '/api/admin/faqs', id ? 'PUT' : 'POST', payload);
            closeModal();
            await load();
        } catch (error) {
            window.alert(error.message);
        }
    });

    document.getElementById('newFaqBtn').addEventListener('click', () => openModal(null));
    document.getElementById('faqModalClose').addEventListener('click', closeModal);
    document.getElementById('faqCancelBtn').addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });

    load();
})();
