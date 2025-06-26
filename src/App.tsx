import { useEffect, useState, useRef } from 'react';
import localforage from 'localforage';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import './App.css'
import DeepSeekPanel from './components/DeepSeekPanel';

export interface Message {
  id: string;
  author: {
    role: string;
  };
  content: {
    content_type: string;
    parts: string[];
  };
}

export interface ConversationNode {
  id: string;
  message: Message;
  parent: string | null;
  children: string[];
}

export interface Conversation {
  id: string;
  title: string;
  create_time: number;
  mapping: { [key: string]: ConversationNode };
  current_node: string;
}

// Initialize separate stores for different types of data
const conversationsStore = localforage.createInstance({
  name: 'gpt-explorer',
  storeName: 'conversations'
});

const formatDate = (timestamp: number) => {
  // Convert timestamp to milliseconds if needed
  let timestampInMs = timestamp;
  
  // If timestamp is in seconds (Unix epoch), convert to milliseconds
  if (timestamp < 1e10) {
    timestampInMs = timestamp * 1000;
  }
  // If timestamp is in microseconds, convert to milliseconds
  else if (timestamp > 1e12) {
    timestampInMs = timestamp / 1000;
  }

  const date = new Date(timestampInMs);
  
  // Verify that the date is reasonable (between 2020 and 2025)
  if (date.getFullYear() < 2020 || date.getFullYear() > 2025) {
    console.warn('Invalid date detected:', date, 'from timestamp:', timestamp);
    return 'Ogiltigt datum';
  }
  
  return date.toLocaleDateString('sv-SE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const getAssistantFromConversation = (conversation: Conversation): string | null => {
  // First check title for explicit mentions
  const title = conversation.title.toLowerCase();
  if (title.includes('lester')) return 'Lester';
  if (title.includes('osho')) return 'Osho';
  if (title.includes('neville')) return 'Neville';

  // If not found in title, check first few assistant messages
  let currentNodeId: string | null = conversation.current_node;
  let checkedMessages = 0;
  const MAX_MESSAGES_TO_CHECK = 5; // Increased from 3 to 5

  while (currentNodeId && checkedMessages < MAX_MESSAGES_TO_CHECK) {
    const node: ConversationNode = conversation.mapping[currentNodeId];
    if (!node) break;

    const message = node.message;
    if (!message || !message.author || !message.content || !Array.isArray(message.content.parts)) {
      currentNodeId = node.parent;
      continue;
    }

    if (message.author.role === 'assistant') {
      checkedMessages++;
      const content = message.content.parts.join(' ').toLowerCase();
      
      if (content.includes('lester')) return 'Lester';
      if (content.includes('osho')) return 'Osho';
      if (content.includes('neville')) return 'Neville';
    }
    
    currentNodeId = node.parent;
  }
  
  return null;
};

const getAssistantName = (conversation: Conversation) => {
  return getAssistantFromConversation(conversation) || 'Assistant';
};

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filteredConversations, setFilteredConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [chatHistory, setChatHistory] = useState<Message[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [gpts, setGpts] = useState({
    Lester: true,
    Osho: true,
    Neville: true
  });
  const [cleanedConversationIds, setCleanedConversationIds] = useState<string[]>([]);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [deleteConfirmation, setDeleteConfirmation] = useState<{id: string, title: string} | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;

    const fetchConversations = async () => {
      try {
        const response = await fetch('/conversations.json', { signal });
        const data = await response.json();
        
        // Log the number of conversations
        console.log('Total conversations loaded:', data.length);
        
        setConversations(data);
        setFilteredConversations(data);
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          console.error("Error fetching conversations:", error);
        }
      }
    };

    fetchConversations();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    let result = conversations;
    
    // Apply search term filter if exists
    if (searchTerm) {
      result = result.filter(c => 
        c.title.toLowerCase().includes(searchTerm.toLowerCase())
      );
      console.log('Conversations after search filter:', result.length);
    }

    // Apply GPT filter if any are selected
    const selectedGpts = Object.entries(gpts)
      .filter(([, checked]) => checked)
      .map(([name]) => name);

    if (selectedGpts.length > 0) {
      result = result.filter(c => {
        const assistant = getAssistantFromConversation(c);
        return assistant && selectedGpts.includes(assistant);
      });
      console.log('Conversations after GPT filter:', result.length);
    }

    setFilteredConversations(result);
  }, [searchTerm, gpts, conversations]);

  useEffect(() => {
    const loadCleanedIds = async () => {
      const ids = await localforage.getItem<string[]>('cleanedConversationIds');
      if (ids) {
        setCleanedConversationIds(ids);
      }
    };
    loadCleanedIds();
  }, []);

  const handleGptChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setGpts({
      ...gpts,
      [event.target.name]: event.target.checked,
    });
  };

  const handleSelectConversation = (conversation: Conversation) => {
    setSelectedConversation(conversation);
    const history: Message[] = [];
    let currentNodeId: string | null = conversation.current_node;
    while (currentNodeId) {
      const currentNode: ConversationNode | undefined = conversation.mapping[currentNodeId];
      if (currentNode && currentNode.message && currentNode.message.content && currentNode.message.content.parts && currentNode.message.content.parts.length > 0) {
        history.unshift(currentNode.message);
      }
      currentNodeId = currentNode?.parent;
    }
    setChatHistory(history);
  };

  const saveConversation = async (id: string) => {
    const updatedIds = [...cleanedConversationIds, id];
    setCleanedConversationIds(updatedIds);
    await localforage.setItem('cleanedConversationIds', updatedIds);
  };

  const clearDatabase = async () => {
    await localforage.clear();
    setCleanedConversationIds([]);
  };

  const exportToPdf = () => {
    if (!chatContainerRef.current) return;

    const input = chatContainerRef.current;
    html2canvas(input).then((canvas) => {
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF();
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`${selectedConversation?.title || 'conversation'}.pdf`);
    });
  };

  const handleDeleteConversation = async (id: string, title: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent conversation selection when clicking delete
    setDeleteConfirmation({ id, title });
  };

  const confirmDelete = async () => {
    if (!deleteConfirmation) return;

    try {
      // Remove from database
      await conversationsStore.removeItem(deleteConfirmation.id);
      
      // Remove from state
      const newConversations = conversations.filter(c => c.id !== deleteConfirmation.id);
      setConversations(newConversations);
      setFilteredConversations(newConversations.filter(c => 
        c.title.toLowerCase().includes(searchTerm.toLowerCase())
      ));

      // Clear selection if deleted conversation was selected
      if (selectedConversation?.id === deleteConfirmation.id) {
        setSelectedConversation(null);
        setChatHistory([]);
      }

      setSyncStatus(`Konversation "${deleteConfirmation.title}" har tagits bort.`);
    } catch (error) {
      console.error('Error deleting conversation:', error);
      setSyncStatus('Ett fel uppstod när konversationen skulle tas bort.');
    }

    setDeleteConfirmation(null);
  };

  const cancelDelete = () => {
    setDeleteConfirmation(null);
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="container mx-auto">
        <h1 className="text-3xl font-bold mb-4">GPT Conversation Explorer</h1>
        {syncStatus && (
          <div className="mb-4 p-2 bg-blue-100 text-blue-800 rounded">
            {syncStatus}
          </div>
        )}
        <DeepSeekPanel conversations={conversations} />
        
        <div className="mt-4">
          <input
            type="text"
            placeholder="Sök konversationer..."
            className="w-full p-2 border rounded"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          
          <div className="flex gap-4 mt-2">
            {Object.entries(gpts).map(([name, checked]) => (
              <label key={name} className="flex items-center">
                <input
                  type="checkbox"
                  name={name}
                  checked={checked}
                  onChange={handleGptChange}
                  className="mr-2"
                />
                {name}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div className="bg-white p-4 rounded shadow">
            <h2 className="text-xl font-bold mb-2">Konversationer</h2>
            <div className="max-h-[600px] overflow-y-auto">
              {filteredConversations.map(conv => (
                <div
                  key={conv.id}
                  className={`p-2 cursor-pointer hover:bg-gray-100 ${selectedConversation?.id === conv.id ? 'bg-blue-100' : ''}`}
                  onClick={() => handleSelectConversation(conv)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">{conv.title}</div>
                      <div className="text-sm text-gray-500">{formatDate(conv.create_time)}</div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteConversation(conv.id, conv.title, e)}
                      className="text-red-600 hover:text-red-800 px-2 py-1 text-sm"
                    >
                      Ta bort
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-4 rounded shadow">
            <h2 className="text-xl font-bold mb-2">Chatthistorik</h2>
            <div ref={chatContainerRef} className="max-h-[600px] overflow-y-auto">
              {chatHistory.map((message, index) => (
                <div key={index} className={`p-4 mb-4 rounded-lg ${message.author.role === 'assistant' ? 'bg-blue-50' : 'bg-gray-50'}`}>
                  <div className="flex justify-between items-center mb-2">
                    <div className="font-bold text-lg">
                      {message.author.role === 'assistant' && selectedConversation 
                        ? getAssistantName(selectedConversation)
                        : message.author.role === 'user' ? 'Du' : message.author.role}
                    </div>
                    <div className="text-sm text-gray-500">
                      {formatDate(selectedConversation?.create_time || 0)}
                    </div>
                  </div>
                  <div className="text-lg whitespace-pre-wrap leading-relaxed">{message.content.parts.join(' ')}</div>
                </div>
              ))}
            </div>
            {selectedConversation && (
              <div className="mt-4">
                <button
                  onClick={exportToPdf}
                  className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                >
                  Exportera till PDF
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Delete Confirmation Dialog */}
        {deleteConfirmation && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
              <h3 className="text-xl font-bold mb-4">Bekräfta borttagning</h3>
              <p className="mb-6">
                Är du säker på att du vill ta bort konversationen "{deleteConfirmation.title}"? 
                Detta går inte att ångra.
              </p>
              <div className="flex justify-end gap-4">
                <button
                  onClick={cancelDelete}
                  className="px-4 py-2 border rounded hover:bg-gray-100"
                >
                  Avbryt
                </button>
                <button
                  onClick={confirmDelete}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Ta bort
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App
