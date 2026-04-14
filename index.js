const TelegramApi = require('node-telegram-bot-api');
const axios = require('axios');
const schedule = require('node-schedule');
const Groq = require("groq-sdk"); 
const { gameOption, againOption, aiOption } = require('./options.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const http = require('http');

// --- 1. ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ ---
const PORT = process.env.PORT || 3000;
const SERVER_URL = `https://assistbot-m7w5.onrender.com`; 
const token = process.env.TELEGRAM_TOKEN; 
const groqKey = process.env.GROQ_API_KEY;
const WHITE_LIST = [1204470331]; 

// --- 2. ИНИЦИАЛИЗАЦИЯ СЕРВЕРА ---
http.createServer((req, res) => {
    res.end('Bot is running');
}).listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

// --- 3. ИНИЦИАЛИЗАЦИЯ БОТА И ИИ ---
const bot = new TelegramApi(token, { polling: true });
const groq = new Groq({ apiKey: groqKey });

const chats = {};   
const aiState = {};

// --- 4. ФУНКЦИЯ САМОПИНГА ---
setInterval(async () => {
    try {
        await axios.get(SERVER_URL);
        console.log('Keep-alive ping sent successfully');
    } catch (e) {
        console.error('Keep-alive ping failed:', e.message);
    }
}, 600000); 

// --- 5. ФУНКЦИЯ ИИ (ЧЕРЕЗ GROQ) ---
async function getAIResponse(prompt) {
    if (!groqKey) return "🤖 Ошибка: GROQ_API_KEY не найден в настройках Render!";
    
    try {
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: "Ты — полезный ИИ-помощник. Отвечай кратко и по делу на русском языке."
                },
                {
                    role: "user",
                    content: prompt,
                },
            ],
            model: "llama-3.3-70b-versatile", 
            temperature: 0.7,
        });

        return completion.choices[0]?.message?.content || "🤖 Не удалось сформировать ответ.";
    } catch (error) {
        console.error("Groq Error:", error);
        if (error.status === 429) return "⚠️ Слишком много запросов! Подожди немного.";
        return "🤖 Ошибка связи с Groq. Проверь API ключ в Render.";
    }
}

// --- 6. ЛОГИКА ИГРЫ ---
const startGame = async (chatId) => {
    const randomNumber = Math.floor(Math.random() * 10);
    chats[chatId] = randomNumber;
    await bot.sendMessage(chatId, `Я загадал число от 0 до 9. Попробуй угадать!`, gameOption);
};

// --- 7. ОБРАБОТКА КОМАНД ---
const start = () => {
    bot.setMyCommands([
        { command: '/start', description: 'Запустить бота' },
        { command: '/info', description: 'Информация о себе' },
        { command: '/ai', description: 'Режим ИИ' },
        { command: '/rates', description: 'Курс валют' },
        { command: '/remind', description: 'Напоминание' },
        { command: '/game', description: 'Сыграть в игру' }
    ]);

    bot.on('message', async msg => {
        const text = msg.text;
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        if (!text) return;

        if (!WHITE_LIST.includes(userId)) {
            return bot.sendMessage(chatId, "⚠️ Извини, это приватный бот.");
        }

        if (text === '/start') return bot.sendMessage(chatId, `Доступ подтвержден. Привет, Босс!`);
        
        if (text === '/info') return bot.sendMessage(chatId, `👤 Профиль: ${msg.from.first_name}\n🆔 ID: ${userId}`);

        if (text === '/rates') {
            try {
                const res = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
                const rub = res.data.rates.RUB;
                const kzt = res.data.rates.KZT;
                return bot.sendMessage(chatId, `📈 **Курс валют за 1$:**\n\n🇰🇿 Тенге: **${kzt.toFixed(2)}**\n🇷🇺 Рубль: **${rub.toFixed(2)}**`, { parse_mode: 'Markdown' });
            } catch (e) {
                return bot.sendMessage(chatId, "❌ Ошибка API валют.");
            }
        }

        if (text.startsWith('/remind')) {
            const args = text.split(' ');
            const mins = parseInt(args[1]);
            const task = args.slice(2).join(' ');
            if (isNaN(mins) || !task) return bot.sendMessage(chatId, "Используй: `/remind 10 Текст`", { parse_mode: 'Markdown' });

            bot.sendMessage(chatId, `✅ Напомню через ${mins} мин.`);
            const date = new Date(Date.now() + mins * 60000);
            schedule.scheduleJob(date, () => {
                bot.sendMessage(chatId, `🔔 **НАПОМИНАНИЕ:**\n\n> ${task}`, { parse_mode: 'Markdown' });
            });
            return;
        }

        if (text === '/game') return startGame(chatId);

        if (text === '/ai') {
            aiState[chatId] = true;
            return bot.sendMessage(chatId, "🤖 Режим ИИ (Groq) включен. Напиши 'Пока', чтобы выключить.");
        }

        if (aiState[chatId] && !text.startsWith('/')) {
            const stopWords = ['пока', 'стоп', 'stop', 'выход'];
            if (stopWords.includes(text.toLowerCase().trim())) {
                aiState[chatId] = false; 
                return bot.sendMessage(chatId, "🤖 Режим ИИ выключен. Был рад помочь!");
            }
            await bot.sendChatAction(chatId, 'typing');
            const aiAnswer = await getAIResponse(text);
            return bot.sendMessage(chatId, aiAnswer); // Убрали aiOption, чтобы не выводить кнопку
        }

        if (!text.startsWith('/')) return bot.sendMessage(chatId, "Команда не распознана.");
    });

    bot.on('callback_query', async msg => {
        const data = msg.data;
        const chatId = msg.message.chat.id;
        if (data === '/again') return startGame(chatId);

        const userGuess = Number(data);
        if (!isNaN(userGuess) && data.length === 1) {
            const resultMsg = userGuess === chats[chatId] ? `🎉 Верно!` : `❌ Нет, это было число ${chats[chatId]}`;
            await bot.sendMessage(chatId, resultMsg, againOption);
            await bot.answerCallbackQuery(msg.id);
        }
    });
};

start();
console.log("🚀 Бот запущен в приватном режиме (Groq)!");