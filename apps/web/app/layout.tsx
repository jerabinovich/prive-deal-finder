import "./globals.css";
import TopNav from "./components/TopNav";
import { ChatContextProvider } from "./components/ChatContextProvider";
import PriveChatPanel from "./components/PriveChatPanel";
import { ToastProvider } from "./components/ToastProvider";

export const metadata = {
  title: "Prive Deal Finder",
  description: "Deal Console",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <ChatContextProvider>
            <div className="app-shell">
              <header className="topbar">
                <div className="container topbar-inner">
                  <a href="/" className="brand">Prive Deal Finder</a>
                  <TopNav />
                </div>
              </header>
              <main className="container page-content">{children}</main>
              <PriveChatPanel />
            </div>
          </ChatContextProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
