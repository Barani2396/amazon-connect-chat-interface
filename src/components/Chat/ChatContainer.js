// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { Component } from "react";
import styled from "styled-components";
import { Button, Loader } from "connect-core";
import Chat from "./Chat";
import ChatSession, { setCurrentChatSessionInstance } from "./ChatSession";
import { initiateChat } from "./ChatInitiator";
import EventBus from "./eventbus";
import "./ChatInterface";
import './ChatEvents';
import { defaultTheme } from "connect-theme";
import { FlexRowContainer } from "connect-theme/Helpers";
import { CHAT_FEATURE_TYPES } from "./constants";
import { ContentType } from "./datamodel/Model";
import { LanguageProvider, LanguageContext } from "../../context/LanguageContext";

const ButtonWrapper = styled.div`
  display: flex;
  justify-content: center;
  margin-top: 10px;
  > button {
    min-width: 85px;
  }
`;

const MessageBoxFail = styled.div`
  padding: 10;
  background-color: red;
`;

const LoadingWrapper = styled(FlexRowContainer)`
  padding: ${({ theme }) => theme.globals.basePadding};
  height: 100%;
`;

const Wrapper = styled.div`
  padding: ${({ theme }) => theme.globals.basePadding};
  height: 100%;
`;

class ChatContainer extends Component {
  constructor(props) {
    super(props);

    this.state = {
      chatSession: null,
      composerConfig: {},
      status: "NotInitiated",
      language: 'en_US'
    };

    this.submitChatInitiationHandler = this.initiateChatSession.bind(this);
    EventBus.on("initChat", this.initiateChatSession.bind(this));
    if (window.connect && window.connect.LogManager) {
      this.logger = window.connect.LogManager.getLogger({
        prefix: "ChatInterface-ChatContainer",
      });
    }
  }
  
  componentDidMount() {
    // On component mount, check for an existing chat session to rehydrate.
    this.checkAndRehydrateChat();
    // Listens for storage events to rehydrate if a chat session is started in another tab.
    window.addEventListener('storage', this.onStorageChange);
  }

  componentWillUnmount() {
    EventBus.off(this.submitChatInitiationHandler);
    window.removeEventListener('storage', this.onStorageChange);
  }

  /**
  * Checks for an existing chat session in local or session storage and rehydrates it if found.
  */
  async checkAndRehydrateChat() { 
    let chatSessionData =  localStorage.getItem('chatSessionData') || sessionStorage.getItem('chatSessionData') || null; 

    if (chatSessionData) {
      try {
        const parsedData = JSON.parse(chatSessionData);
        const chatDetails = parsedData.chatDetails;

        if (chatDetails && chatDetails.startChatResult && chatDetails.startChatResult.ContactId && chatDetails.startChatResult.ParticipantId) {
          this.logger.info("Found existing chat session based on persistence key. Rehydrating... V5");
          this.logger.info("Data being passed to openChatSession from checkAndRehydrateChat:", chatDetails);

          const chatSession = await this.openChatSession(
            chatDetails,
            parsedData.displayName,
            parsedData.region,
            parsedData.stage,
            parsedData.customizationParams
          );

          this.setState({
            status: "Initiated",
            chatSession: chatSession,
            composerConfig: parsedData.composerConfig,
            language: parsedData.language
          });
          return;
        }
      } catch (error) {
        this.logger.error("Failed to parse chat session data from persistence key. Starting new chat.", error);
        localStorage.removeItem('chatSessionData');
        sessionStorage.removeItem('chatSessionData');
      }
    }

    this.setState({ status: "NotInitiated" });
  }

  /**
  * Event handler for 'storage' events. Triggers rehydration logic when a chat session is saved in another tab.
  */
  onStorageChange = (event) => {
    if (event.key === 'chatSessionData') {
        this.logger.info("Storage event detected. Checking for new chat session.");
        this.checkAndRehydrateChat();
    }
  }

  initiateChatSession(chatDetails, success, failure) { 
    const logContent = { 
      contactFlowId: chatDetails.contactFlowId ? chatDetails.contactFlowId : null, 
      instanceId: chatDetails.instanceId ? chatDetails.instanceId : null, 
      region: chatDetails.region ? chatDetails.region : null, 
      stage: chatDetails.stage ? chatDetails.stage : null, 
      featurePermissions: chatDetails.featurePermissions ? chatDetails.featurePermissions : null, 
      apiGatewayEndpoint: chatDetails.apiGatewayEndpoint ? chatDetails.apiGatewayEndpoint : null, 
    }; 
    this.logger && this.logger.info("Chat session meta data:", logContent); 
    // Call the function to submit a new chat
    this.submitChatInitiation(chatDetails, success, failure); 
  } 

  /** 
  * Initiate a chat in 2 steps. 
  * 
  * Step 1: Create a chat session within Amazon Connect (more details in ChatInitiator.js) 
  * This step provides us with a 'chatDetails' object that contains among others: 
  * - Auth Token 
  * - Websocket endpoint 
  * - ContactId 
  * - ConnectionId 
  * 
  * Step 2: Connect to created chat session. 
  * Open a websocket connection via Chat.JS (more details in ChatSession.js) 
  * 
  * @param {*} input 
  * @param {*} success 
  * @param {*} failure 
  */ 
  async submitChatInitiation(input, success, failure) { 
    this.setState({ status: "Initiating" }); 
    const customizationParams = { 
      authenticationRedirectUri: input.authenticationRedirectUri || '', 
      authenticationIdentityProvider: input.authenticationIdentityProvider || '' 
    } 
    try { 
      const chatDetails = await initiateChat(input);

      // Add this log to see what data you're passing to openChatSession on first run
      this.logger.info("Data being passed to openChatSession from submitChatInitiation:", chatDetails);
 
      const chatSession = await this.openChatSession(chatDetails, input.name, input.region, input.stage, customizationParams); 

      this.saveChatSession(input, chatDetails, customizationParams);

      setCurrentChatSessionInstance(chatSession); 
      const attachmentsEnabled = 
        (input.featurePermissions && input.featurePermissions[CHAT_FEATURE_TYPES.ATTACHMENTS]) || 
        (chatDetails.featurePermissions && chatDetails.featurePermissions[CHAT_FEATURE_TYPES.ATTACHMENTS]); 
      const richMessagingEnabled = typeof input.supportedMessagingContentTypes === "string" ? input.supportedMessagingContentTypes.split(",").includes(ContentType.MESSAGE_CONTENT_TYPE.TEXT_MARKDOWN) : false; 
      const language = input.language || "en_US"; 
      this.setState({ 
        status: "Initiated", 
        chatSession: chatSession, 
        composerConfig: { 
          attachmentsEnabled, 
          richMessagingEnabled, 
        }, 
        language 
      }); 
      success && success(chatSession); 
    } catch (error) { 
      this.setState({ status: "InitiateFailed" }); 
      failure && failure(error); 
    } 
  }

  /**
  * Saves the chat session details to either local or session storage.
  * Clears both storage types before saving to prevent conflicts.
  */
  saveChatSession(input, chatDetails, customizationParams) {
    const storage = window[input.chatPersistence];

    localStorage.removeItem('chatSessionData');
    sessionStorage.removeItem('chatSessionData');

    if (storage) {
      const chatSessionData = {
        chatDetails: chatDetails,
        displayName: input.name, 
        region: input.region,
        stage: input.stage,
        customizationParams: customizationParams,
        language: input.language,
        composerConfig: {
          attachmentsEnabled: (input.featurePermissions && input.featurePermissions[CHAT_FEATURE_TYPES.ATTACHMENTS]) ||
          (chatDetails.featurePermissions && chatDetails.featurePermissions[CHAT_FEATURE_TYPES.ATTACHMENTS]),
          richMessagingEnabled: typeof input.supportedMessagingContentTypes === "string" ? input.supportedMessagingContentTypes.split(",").includes(ContentType.MESSAGE_CONTENT_TYPE.TEXT_MARKDOWN) : false,
        }
      };
      storage.setItem('chatSessionData', JSON.stringify(chatSessionData));
    } else {
      localStorage.removeItem('chatSessionData');
      sessionStorage.removeItem('chatSessionData');
    }
  }

  openChatSession(chatDetails, name, region, stage, customizationParams) {
    // Handle data from either a new chat or a rehydrated chat.
    const finalChatDetails = chatDetails.startChatResult ? chatDetails : { startChatResult: chatDetails };

    // Create the new ChatSession instance
    const chatSession = new ChatSession(
      finalChatDetails, 
      name, 
      region, 
      stage, 
      customizationParams
    );

    // Set up event listeners
    chatSession.onChatClose(() => {
      EventBus.trigger("endChat", {});
    });

    // Open the connection and return the session instance
    return chatSession.openChatSession().then(() => {
      return chatSession;
    });
  }

  resetState = () => {
    localStorage.removeItem('chatSessionData'); // Clear session on reset
    sessionStorage.removeItem('chatSessionData'); // Clear session on reset
    this.setState({ status: "NotInitiated", chatSession: null });
    this.logger && this.logger.info("Chat session is reset");
  };

  render() {
    if ("NotInitiated" === this.state.status || "Initiating" === this.state.status) {
      return (
        <LoadingWrapper center={true}>
          <Loader color={defaultTheme.color.primary} size={30} />
        </LoadingWrapper>
      );
    }

    if ("InitiateFailed" === this.state.status) {
      return (
        <Wrapper>
          <MessageBoxFail>Initialization failed</MessageBoxFail>
          <ButtonWrapper>
            <Button col="2" type="tertiary" onClick={this.resetState}>
              <span>Go Back</span>
            </Button>
          </ButtonWrapper>
        </Wrapper>
      );
    }
    return (
        <LanguageProvider>
          <LanguageContext.Consumer>
            {({changeLanguage}) => (<>
              <Chat
                  chatSession={this.state.chatSession}
                  composerConfig={this.state.composerConfig}
                  onEnded={this.resetState}
                  changeLanguage={changeLanguage}
                  language={this.state.language}
                  {...this.props} />
            </>)}
          </LanguageContext.Consumer>
        </LanguageProvider>
    );
  }
}

export default ChatContainer;
