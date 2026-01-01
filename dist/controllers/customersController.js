export const listCustomers = async (req, res) => {
    // tenantId would be used for filtering in full implementation
    res.json({ items: [] });
};
export const getCustomer = async (req, res) => {
    res.json({ id: req.params.customerId, tenantId: 'tenant-sample' });
};
export const ingestCustomerEvent = async (req, res) => {
    // validate event, push to event bus, update embeddings
    res.status(202).send();
};
