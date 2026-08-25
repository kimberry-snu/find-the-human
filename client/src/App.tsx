import { GameScreen } from './components/GameScreen';
import { DefenseScreen } from './components/DefenseScreen';
import { HomeScreen } from './components/HomeScreen';
import { LobbyScreen } from './components/LobbyScreen';
import { ResultScreen } from './components/ResultScreen';
import { RevealScreen } from './components/RevealScreen';
import { Toast } from './components/Toast';
import { WifiOffIcon } from './components/icons';
import { useGameSocket } from './hooks/useGameSocket';

function ReconnectScreen() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <div className="relative mx-auto h-16 w-16">
          <span className="absolute inset-0 animate-ping rounded-full border border-electric/20" />
          <span className="absolute inset-2 grid place-items-center rounded-2xl border border-white/10 bg-white/[0.05] text-2xl">
            ◉
          </span>
        </div>
        <h1 className="mt-6 text-xl font-black text-white">게임으로 돌아가는 중</h1>
        <p className="mt-2 text-xs font-medium leading-5 text-white/35">
          저장된 참가자 정보를 확인하고 있어요.
          <br />
          잠시만 기다려 주세요.
        </p>
      </div>
    </main>
  );
}

export default function App() {
  const { state, actions } = useGameSocket();
  const isHost =
    state.hostId === state.playerId ||
    state.players.some((player) => player.id === state.playerId && player.isHost);
  const automaticReveal = state.automaticReveals[0];

  let screen: React.ReactNode;
  if (state.reconnecting && !state.roomCode) {
    screen = <ReconnectScreen />;
  } else if (automaticReveal) {
    screen = (
      <RevealScreen
        reveal={automaticReveal}
        round={state.round}
        totalRounds={state.totalRounds}
        endsAt={null}
        yourAnonName={state.yourAnonName}
      />
    );
  } else if (state.result) {
    screen = (
      <ResultScreen
        result={state.result}
        spectatorMode={state.settings.spectatorMode}
        roomCode={state.roomCode}
        isHost={isHost}
        onAgain={actions.playAgain}
        onNotify={actions.notify}
      />
    );
  } else if (state.gameStarted && state.phase === 'REVEAL' && state.reveal) {
    screen = (
      <RevealScreen
        reveal={state.reveal}
        round={state.round}
        totalRounds={state.totalRounds}
        endsAt={state.endsAt}
        yourAnonName={state.yourAnonName}
      />
    );
  } else if (state.gameStarted && state.phase === 'DEFENSE') {
    screen = (
      <DefenseScreen
        defenseTarget={state.defenseTarget}
        endsAt={state.endsAt}
        yourAnonName={state.yourAnonName}
        isSpectator={state.isSpectator}
        connected={state.connected}
        messages={state.messages}
        defenseMessageSent={state.defenseMessageSent}
        onSend={actions.sendChat}
      />
    );
  } else if (state.gameStarted) {
    screen = (
      <GameScreen
        phase={state.phase}
        round={state.round}
        totalRounds={state.totalRounds}
        endsAt={state.endsAt}
        questionCard={state.questionCard}
        messages={state.messages}
        typingNames={state.typingNames}
        yourAnonName={state.yourAnonName}
        isSpectator={state.isSpectator}
        participants={state.participants}
        eliminatedNames={state.eliminatedNames}
        eliminationHistory={state.eliminationHistory}
        hasVoted={state.hasVoted}
        connected={state.connected}
        spectatorMode={state.settings.spectatorMode}
        interrogation={state.interrogation}
        interrogationUsed={state.interrogationUsed}
        spectatorBet={state.spectatorBet}
        onSend={actions.sendChat}
        onVote={actions.castVote}
        onUseInterrogation={actions.useInterrogation}
        onPlaceSpectatorBet={actions.placeSpectatorBet}
      />
    );
  } else if (state.roomCode) {
    screen = (
      <LobbyScreen
        roomCode={state.roomCode}
        playerId={state.playerId}
        players={state.players}
        settings={state.settings}
        hostId={state.hostId}
        busy={state.busy}
        connected={state.connected}
        onStart={actions.startGame}
        onNotify={actions.notify}
      />
    );
  } else {
    screen = (
      <HomeScreen
        connected={state.connected}
        connecting={state.connecting}
        busy={state.busy}
        onCreate={actions.createRoom}
        onJoin={actions.joinRoom}
      />
    );
  }

  return (
    <div className="app-bg min-h-dvh bg-ink-950 text-white">
      <div className="relative mx-auto min-h-dvh w-full max-w-[520px] overflow-hidden border-white/[0.06] bg-ink-950/80 shadow-2xl sm:border-x">
        {screen}
      </div>

      {!state.connected && state.roomCode ? (
        <div
          className="fixed inset-x-3 top-[max(10px,env(safe-area-inset-top))] z-50 mx-auto flex max-w-[460px] animate-toast-in items-center justify-center gap-2 rounded-xl border border-amber-300/15 bg-[#211c10]/95 px-3 py-2 text-[11px] font-bold text-amber-100/75 shadow-xl backdrop-blur"
          role="status"
        >
          <WifiOffIcon className="h-4 w-4" />
          연결이 끊겼어요 · 자동으로 다시 연결 중
        </div>
      ) : null}

      {state.notice ? (
        <div className="pointer-events-none fixed inset-x-3 bottom-[max(14px,env(safe-area-inset-bottom))] z-[60] flex justify-center">
          <Toast notice={state.notice} onDismiss={actions.dismissNotice} />
        </div>
      ) : null}
    </div>
  );
}
