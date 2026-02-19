function semanticRoute(content) {
    // BLOODHOUND PROTOCOL - Asset Recovery
    if (/(find|search|hunt|scan|lost|unclaimed|dormant|recover).*(money|crypto|wallet|funds|super|airdrop|assets)/i.test(content)) {
        return { intent: "bloodhound", mode: "bloodhound", temperature: 0.1, injectThinking: true };
    }
    
    // WAR ROOM PROTOCOL - Systems Analysis
    if (/(conflict|war|strategy|crisis|geopolitics|breakdown|infrastructure|stakeholder|political|economy|collapse|systemic)/i.test(content)) {
        return { intent: "war_room", mode: "war_room", temperature: 0.1, injectThinking: true };
    }
    
    // DEV MODE - Code/System tasks
    if (/(code|script|function|implement|debug|fix|deploy|server|database|api|docker|git|npm|pip|bash|terminal|file|directory|edit|write.*code|create.*app|build.*component)/i.test(content)) {
        return { intent: "dev", mode: "dev", temperature: 0.3, injectThinking: true };
    }
    
    // SIMPLE CHAT - Greetings
    if (/^(hi|hello|hey|thanks|yo|sup|good morning|good night|gm|gn)$/i.test(content.trim())) {
        return { intent: "chat", mode: "main", temperature: 0.7, injectThinking: false };
    }
    
    // EXPLICIT/NSFW - Route to main (unrestricted)
    if (/(nsfw|porn|erotic|sex|nude|xxx|hentai|fetish|kinky)/i.test(content)) {
        return { intent: "nsfw", mode: "main", temperature: 0.8, injectThinking: false };
    }
    
    // DEFAULT - General conversation
    return { intent: "general", mode: "main", temperature: 0.5, injectThinking: false };
}

module.exports = { semanticRoute };
