import Exa from 'exa-js';

const devKey = import.meta.env.VITE_EXA_API_TOKEN;
const userKey = window.localStorage.getItem('exa-key');
let key: string = (devKey !== undefined ? devKey : userKey !== null ? userKey : 'place your token here');

let exa = new Exa(key);

export const initializeExa = () => {
    const newUserKey = window.localStorage.getItem('exa-key');
    console.log("Exa re-initialized: ", newUserKey);
    exa = new Exa((newUserKey !== null ? newUserKey : 'place your token here'));
    key = (newUserKey !== null ? newUserKey : 'place your token here');
};

export const exaSearch = async (query: string, maxCharacters: number = 1000) => {
    console.log('Searching with Exa', query, exa !== null);
    return await exa.searchAndContents(
        query, {
        text: { "maxCharacters": maxCharacters }
        }
    );
}

export const exaAnswer = async (query: string) => {
    console.log('Answering with Exa', query, exa !== null);
    return await exa.answer(query, { text: true });
}

export const exaFindSimilar = async (query: string) => {
    return await exa.findSimilarAndContents(query, { text: true });
}