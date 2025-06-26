import React, { useState } from 'react';
import axios from 'axios';
import type { Conversation, ConversationNode } from '../App';

interface DeepSeekPanelProps {
  conversations: Conversation[];
}

const DeepSeekPanel: React.FC<DeepSeekPanelProps> = ({ conversations }) => {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const handlePromptSubmit = async () => {
    setIsLoading(true);
    setResponse('');

    // Simple parsing: "Sammanfatta [GPT] om [ämne]"
    const match = prompt.match(/Sammanfatta alla (Lester|Osho|Neville)-konversationer om (.*)/i);

    if (!match) {
      setResponse("Couldn't understand the prompt. Use the format: 'Sammanfatta alla [Lester/Osho/Neville]-konversationer om [topic]'");
      setIsLoading(false);
      return;
    }

    const [, gptName, topic] = match;
    
    const relevantConversations = conversations.filter(c =>
      c.title.toLowerCase().includes(gptName.toLowerCase())
    );

    let contentToSummarize = '';
    relevantConversations.forEach(convo => {
      let currentId: string | null = convo.current_node;
      while(currentId) {
        const node: ConversationNode | undefined = convo.mapping[currentId];
        if (node && node.message && node.message.content.parts.join('').toLowerCase().includes(topic.toLowerCase())) {
          contentToSummarize += node.message.content.parts.join('') + '\n\n';
        }
        currentId = node?.parent;
      }
    });

    if (!contentToSummarize) {
      setResponse(`No content found for '${topic}' in ${gptName} conversations.`);
      setIsLoading(false);
      return;
    }

    const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY;
    
    if (!apiKey) {
      setResponse("DeepSeek API key is missing. Please add it to your .env.local file as VITE_DEEPSEEK_API_KEY.");
      setIsLoading(false);
      return;
    }

    try {
      const apiResponse = await axios.post(
        'https://api.deepseek.com/v1/chat/completions',
        {
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: `Please summarize the following text about "${topic}":\n\n${contentToSummarize}` },
          ],
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
        }
      );
      setResponse(apiResponse.data.choices[0].message.content);
    } catch (error) {
      console.error('Error calling DeepSeek API:', error);
      setResponse('An error occurred while contacting the AI assistant.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 border-t">
      <h2 className="text-xl font-semibold mb-2">DeepSeek AI Assistant</h2>
      <textarea
        className="w-full p-2 border rounded"
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g., 'Sammanfatta alla Lester-konversationer om rädsla'"
      />
      <button
        onClick={handlePromptSubmit}
        className="w-full p-2 mt-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-purple-300"
        disabled={isLoading || !prompt}
      >
        {isLoading ? 'Thinking...' : 'Ask AI'}
      </button>
      {response && (
        <div className="mt-4 p-4 bg-gray-100 rounded">
          <h3 className="font-semibold">AI Response:</h3>
          <p className="whitespace-pre-wrap">{response}</p>
        </div>
      )}
    </div>
  );
};

export default DeepSeekPanel; 