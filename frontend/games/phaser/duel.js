registerGame("duel", "🤠 Quick Draw", "SPACE = P1, ENTER = P2", "Wild west duel — react fastest!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#2e1a0a");
    this.add.rectangle(W/2,H-20,W,40,0x443322);
    this.p1=this.add.rectangle(150,H-60,30,50,0xf7c948);this.p2=this.add.rectangle(W-150,H-60,30,50,0xe94560);
    this.add.text(150,H-100,"P1",{fontSize:"16px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);
    this.add.text(W-150,H-100,"P2",{fontSize:"16px",color:"#e94560",fontFamily:"monospace"}).setOrigin(0.5);
    this.msgTxt=this.add.text(W/2,H/2,"WAIT...",{fontSize:"48px",color:"#888",fontFamily:"monospace"}).setOrigin(0.5);
    this.state="waiting";this.round=0;this.s1=0;this.s2=0;
    this.scoreTxt=this.add.text(W/2,30,"P1: 0 | P2: 0  (first to 3)",{fontSize:"18px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.input.keyboard.on("keydown-SPACE",()=>this.shoot("P1"));
    this.input.keyboard.on("keydown-ENTER",()=>this.shoot("P2"));
    this.startRound();
  }
  startRound(){
    this.state="waiting";this.msgTxt.setText("WAIT...").setColor("#888");
    this.time.delayedCall(Phaser.Math.Between(1500,4000),()=>{
      if(this.state==="waiting"){this.state="draw";this.msgTxt.setText("DRAW!").setColor("#ff4444");}
    });
  }
  shoot(who){
    if(this.state==="done")return;
    if(this.state==="waiting"){
      const loser=who;const winner=who==="P1"?"P2":"P1";
      this.msgTxt.setText(loser+" shot too early! "+winner+" wins round!").setColor("#ff8800").setFontSize(20);
      if(winner==="P1")this.s1++;else this.s2++;
    }else if(this.state==="draw"){
      this.msgTxt.setText(who+" draws first!").setColor("#4ecca3").setFontSize(28);
      if(who==="P1")this.s1++;else this.s2++;
    }
    this.state="cooldown";
    this.scoreTxt.setText("P1: "+this.s1+" | P2: "+this.s2+"  (first to 3)");
    if(this.s1>=3||this.s2>=3){this.state="done";this.time.delayedCall(1000,()=>{this.msgTxt.setText((this.s1>=3?"P1":"P2")+" WINS THE DUEL!").setColor("#f7c948").setFontSize(32);});}
    else this.time.delayedCall(2000,()=>this.startRound());
  }
  update(){}
});
