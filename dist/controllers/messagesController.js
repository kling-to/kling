export const listMessageLogs = async (req, res) => {
    res.json({ items: [] });
};
export const getMessageLog = async (req, res) => {
    res.json({ id: req.params.messageId, status: 'sent' });
};
export const retryMessage = async (req, res) => {
    // re-enqueue provider send
    res.status(202).send();
};
