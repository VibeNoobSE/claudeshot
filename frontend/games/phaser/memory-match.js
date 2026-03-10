registerGame("memory-match", "🧠 Memory Match", "Click cards to find pairs", "Find the most pairs — take turns!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1e1a2e");
    const symbols=["A","B","C","D","E","F","G","H"];
    const pairs=[...symbols,...symbols];Phaser.Utils.Array.Shuffle(pairs);
    this.cards=[];this.flipped=[];this.turn=0;this.s=[0,0];this.locked=false;
    this.sTxt=this.add.text(W/2,16,"P1: 0 | P2: 0 — P1's turn",{fontSize:"18px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    for(let i=0;i<16;i++){
      const col=i%4,row=Math.floor(i/4);
      const x=W/2-120+col*80,y=80+row*90;
      const card=this.add.rectangle(x,y,60,70,0x334466).setStrokeStyle(2,0x556688).setInteractive();
      const txt=this.add.text(x,y,pairs[i],{fontSize:"28px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5).setVisible(false);
      card.setData("sym",pairs[i]);card.setData("txt",txt);card.setData("idx",i);
      card.on("pointerdown",()=>this.flipCard(card));
      this.cards.push(card);
    }
  }
  flipCard(card){
    if(this.locked||!card.active)return;
    if(this.flipped.includes(card))return;
    card.fillColor=0x556688;card.getData("txt").setVisible(true);
    this.flipped.push(card);
    if(this.flipped.length===2){this.locked=true;
      const [a,b]=this.flipped;
      if(a.getData("sym")===b.getData("sym")){
        this.s[this.turn]++;this.flipped=[];this.locked=false;
        this.time.delayedCall(300,()=>{a.setVisible(false);a.getData("txt").setVisible(false);b.setVisible(false);b.getData("txt").setVisible(false);a.disableInteractive();b.disableInteractive();});
        this.sTxt.setText("P1: "+this.s[0]+" | P2: "+this.s[1]+" — "+(this.turn===0?"P1":"P2")+"'s turn");
        if(this.s[0]+this.s[1]>=8)this.add.text(W/2,H-30,(this.s[0]>this.s[1]?"P1":"P2")+" WINS!",{fontSize:"28px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);
      }else{this.time.delayedCall(800,()=>{a.fillColor=0x334466;a.getData("txt").setVisible(false);b.fillColor=0x334466;b.getData("txt").setVisible(false);this.flipped=[];this.locked=false;this.turn=1-this.turn;
        this.sTxt.setText("P1: "+this.s[0]+" | P2: "+this.s[1]+" — "+(this.turn===0?"P1":"P2")+"'s turn");});}
    }
  }
  update(){}
});
